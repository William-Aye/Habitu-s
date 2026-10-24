import { Linking, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { initI18n } from '../src/i18n';
import AdminLayout from '../src/app/admin/_layout';
import AdminQueue from '../src/app/admin/[queue]';
import AdminHome from '../src/app/admin/index';
import { supabase } from '../src/lib/supabase';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mockFocusCbs = new Set<() => void>();
let mockParams: Record<string, string> = { queue: 'reports' };
jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
    useLocalSearchParams: () => mockParams,
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
    Stack: () => <Text>stack</Text>,
    useFocusEffect: (cb: () => void | (() => void)) => {
      require('react').useEffect(() => {
        const clean = cb();
        mockFocusCbs.add(cb);
        return () => {
          mockFocusCbs.delete(cb);
          if (typeof clean === 'function') clean();
        };
      }, [cb]);
    },
  };
});
let mockSession = { status: 'ready', userId: 'admin1', profile: { firstName: 'Ada' } };
jest.mock('../src/features/account/useSession', () => ({ useSession: () => mockSession }));
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      mfa: {
        listFactors: jest.fn(),
        enroll: jest.fn(),
        unenroll: jest.fn(),
        challenge: jest.fn(),
        verify: jest.fn(),
        getAuthenticatorAssuranceLevel: jest.fn(),
      },
    },
    rpc: jest.fn(),
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}));

const mfa = supabase.auth.mfa as unknown as Record<string, jest.Mock>;
const rpc = supabase.rpc as unknown as jest.Mock;
const from = supabase.from as unknown as jest.Mock;
const storageFrom = supabase.storage.from as unknown as jest.Mock;

let role = 'admin';
let assocRows: unknown[] = [];
let rpcHandlers: Record<string, (args: any) => { data?: unknown; error?: any }> = {};

/** Table reads: profiles (own role), categories, associations, banned_words. */
function table(name: string) {
  const rows: Record<string, unknown> = {
    profiles: { role },
    categories: [
      { id: 'root1', parent_id: null, name_fr: 'Sport' },
      { id: 'root2', parent_id: null, name_fr: 'Culture' },
      { id: 'child1', parent_id: 'root1', name_fr: 'Yoga' },
    ],
    associations: assocRows,
    banned_words: [],
  };
  const result = { data: rows[name], error: null };
  const chain: any = {};
  for (const m of ['select', 'eq', 'is', 'ilike', 'limit', 'order']) chain[m] = () => chain;
  chain.maybeSingle = async () => result;
  chain.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
  return chain;
}

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { queue: 'reports' };
  mockSession = { status: 'ready', userId: 'admin1', profile: { firstName: 'Ada' } };
  role = 'admin';
  assocRows = [];
  rpcHandlers = {};
  rpc.mockImplementation(async (name: string, args: any) => {
    const h = rpcHandlers[name];
    return h ? h(args) : { data: null, error: null };
  });
  from.mockImplementation(table);
  mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'f1' }], all: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] }, error: null });
  mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1' }, error: null });
  mfa.challenge.mockResolvedValue({ data: { id: 'c1' }, error: null });
  mfa.verify.mockResolvedValue({ data: {}, error: null });
});

async function openLayout() {
  await render(<AdminLayout />);
}

describe('route guard', () => {
  it('sends a non-admin away without showing anything', async () => {
    role = 'user';
    await openLayout();
    expect(await screen.findByText('redirect:/')).toBeTruthy();
    expect(mfa.listFactors).not.toHaveBeenCalled();
    expect(screen.queryByText('stack')).toBeNull();
  });

  it('sends a signed-out visitor away', async () => {
    mockSession = { status: 'signed_out', userId: null as any, profile: null as any };
    await openLayout();
    expect(await screen.findByText('redirect:/')).toBeTruthy();
  });
});

describe('two-factor gate', () => {
  it('asks for the code at aal1 and shows the area once it is verified', async () => {
    await openLayout();
    const field = await screen.findByLabelText('Code à 6 chiffres');
    expect(screen.queryByText('stack')).toBeNull();
    const button = screen.getByRole('button', { name: 'Vérifier' });
    expect(button.props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(field, '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByText('stack')).toBeTruthy();
    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: 'f1' });
    expect(mfa.verify).toHaveBeenCalledWith({ factorId: 'f1', challengeId: 'c1', code: '123456' });
  });

  it('goes straight in at aal2', async () => {
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2' }, error: null });
    await openLayout();
    expect(await screen.findByText('stack')).toBeTruthy();
  });

  it('keeps the screen and shows an error on a wrong code', async () => {
    mfa.verify.mockResolvedValue({ data: null, error: { code: 'mfa_verification_failed', message: 'invalid' } });
    await openLayout();
    await fireEvent.changeText(await screen.findByLabelText('Code à 6 chiffres'), '000000');
    await fireEvent.press(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByText('Code incorrect. Réessayez.')).toBeTruthy();
    expect(screen.queryByText('stack')).toBeNull();
  });

  it('enrols a new admin with a QR code and the secret', async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [] }, error: null });
    mfa.enroll.mockResolvedValue({
      data: {
        id: 'new1',
        totp: { qr_code: 'data:image/svg+xml;utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E', secret: 'JBSWY3DPEHPK3PXP' },
      },
      error: null,
    });
    await openLayout();
    expect(await screen.findByText('Activer la double authentification')).toBeTruthy();
    expect(screen.getByLabelText("Code QR à scanner avec votre application d'authentification")).toBeTruthy();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
    expect(mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: expect.stringMatching(/^admin-\d+$/) });
    await fireEvent.changeText(screen.getByLabelText('Code à 6 chiffres'), '654321');
    await fireEvent.press(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByText('stack')).toBeTruthy();
    expect(mfa.verify).toHaveBeenCalledWith({ factorId: 'new1', challengeId: 'c1', code: '654321' });
  });

  it('removes a half-finished enrolment before starting a new one', async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [], all: [{ id: 'old', factor_type: 'totp', status: 'unverified' }] }, error: null });
    mfa.enroll.mockResolvedValue({ data: { id: 'n', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg"/>', secret: 'S' } }, error: null });
    await openLayout();
    await screen.findByText('Activer la double authentification');
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'old' });
  });

  it('asks for the code again when the server refuses at aal1', async () => {
    mfa.getAuthenticatorAssuranceLevel
      .mockResolvedValueOnce({ data: { currentLevel: 'aal2' }, error: null })
      .mockResolvedValue({ data: { currentLevel: 'aal1' }, error: null });
    rpcHandlers.admin_reports = () => ({ data: null, error: { code: '42501', message: 'not_allowed' } });
    const { MfaGate } = require('../src/features/admin/MfaGate');
    await render(
      <MfaGate>
        <AdminQueue />
      </MfaGate>,
    );
    expect(await screen.findByLabelText('Code à 6 chiffres')).toBeTruthy();
  });

  it('shows a network-type message, not "wrong code", when verification cannot run', async () => {
    mfa.challenge.mockRejectedValue(new Error('offline'));
    await openLayout();
    await fireEvent.changeText(await screen.findByLabelText('Code à 6 chiffres'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByText('Vérification impossible. Réessayez.')).toBeTruthy();
    expect(screen.queryByText('Code incorrect. Réessayez.')).toBeNull();
  });

  it('never removes a verified factor', async () => {
    await openLayout();
    await screen.findByLabelText('Code à 6 chiffres');
    expect(mfa.unenroll).not.toHaveBeenCalled();
    expect(mfa.enroll).not.toHaveBeenCalled();
  });

  it('lets the admin leave', async () => {
    const { router } = require('expo-router');
    await openLayout();
    await fireEvent.press(await screen.findByRole('button', { name: 'Quitter' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('verifies only once when the button is pressed twice in the same tick', async () => {
    await openLayout();
    await fireEvent.changeText(await screen.findByLabelText('Code à 6 chiffres'), '123456');
    const button = screen.getByRole('button', { name: 'Vérifier' });
    await act(async () => {
      void fireEvent.press(button);
      void fireEvent.press(button);
    });
    await screen.findByText('stack');
    expect(mfa.verify).toHaveBeenCalledTimes(1);
  });
});

const REPORT = {
  id: 'r1',
  created_at: '2026-10-24T10:00:00Z',
  source: 'user',
  target_type: 'message',
  target_id: 'm1',
  reason: 'harassment',
  details: null,
  status: 'open',
  reporter_first_name: 'Lea',
  target_owner: { id: 'u9', first_name: 'Marc' },
  preview: 'Un message gênant',
};
const AUTO = { ...REPORT, id: 'r2', source: 'auto', reporter_first_name: null, preview: 'Spam' };

describe('reports queue', () => {
  beforeEach(() => {
    rpcHandlers.admin_reports = () => ({ data: { open_count: 2, items: [REPORT, AUTO] }, error: null });
  });

  it('shows the preview, reason, source and owner', async () => {
    await render(<AdminQueue />);
    expect(await screen.findByText('Un message gênant')).toBeTruthy();
    expect(screen.getAllByText('Harcèlement').length).toBeGreaterThan(0);
    expect(screen.getByText('Signalé par Lea')).toBeTruthy();
    expect(screen.getAllByText('Concerne : Marc').length).toBe(2);
    expect(screen.getByText('Automatique')).toBeTruthy();
  });

  it('keeps decisions disabled until the statement is long enough', async () => {
    await render(<AdminQueue />);
    await screen.findByText('Un message gênant');
    const [retire] = screen.getAllByRole('button', { name: 'Retirer' });
    expect(retire.props.accessibilityState.disabled).toBe(true);
    const [field] = screen.getAllByLabelText('Motif de la décision (obligatoire)');
    await fireEvent.changeText(field, 'court');
    expect(screen.getAllByRole('button', { name: 'Retirer' })[0].props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(field, 'Message de harcèlement avéré');
    expect(screen.getAllByRole('button', { name: 'Retirer' })[0].props.accessibilityState.disabled).toBe(false);
  });

  it('decides with the statement and removes the item', async () => {
    rpcHandlers.admin_decide_report = () => ({ data: null, error: null });
    await render(<AdminQueue />);
    await screen.findByText('Un message gênant');
    await fireEvent.changeText(screen.getAllByLabelText('Motif de la décision (obligatoire)')[0], '  Message de harcèlement avéré ');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Retirer' })[0]);
    await waitFor(() => expect(screen.queryByText('Un message gênant')).toBeNull());
    expect(rpc).toHaveBeenCalledWith('admin_decide_report', {
      p_report: 'r1',
      p_decision: 'remove',
      p_statement: 'Message de harcèlement avéré',
    });
    expect(screen.getByText('Spam')).toBeTruthy();
  });

  it('asks twice before banning', async () => {
    rpcHandlers.admin_decide_report = () => ({ data: null, error: null });
    await render(<AdminQueue />);
    await screen.findByText('Un message gênant');
    await fireEvent.changeText(screen.getAllByLabelText('Motif de la décision (obligatoire)')[0], 'Harcèlement répété et avéré');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Bannir' })[0]);
    expect(rpc).not.toHaveBeenCalledWith('admin_decide_report', expect.anything());
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirmer le bannissement' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('admin_decide_report', {
        p_report: 'r1',
        p_decision: 'ban',
        p_statement: 'Harcèlement répété et avéré',
      }),
    );
  });

  it('decides once when a button is pressed twice in the same tick', async () => {
    rpcHandlers.admin_decide_report = () => ({ data: null, error: null });
    await render(<AdminQueue />);
    await screen.findByText('Un message gênant');
    await fireEvent.changeText(screen.getAllByLabelText('Motif de la décision (obligatoire)')[0], 'Message de harcèlement avéré');
    const button = screen.getAllByRole('button', { name: 'Avertir' })[0];
    await act(async () => {
      void fireEvent.press(button);
      void fireEvent.press(button);
    });
    await waitFor(() => expect(screen.queryByText('Un message gênant')).toBeNull());
    expect(rpc.mock.calls.filter((c) => c[0] === 'admin_decide_report')).toHaveLength(1);
    expect(screen.getByText('Décision enregistrée.')).toBeTruthy();
  });

  it('shows an inline refusal and stays in the area when an admin is refused at aal2', async () => {
    rpcHandlers.admin_decide_report = () => ({ data: null, error: { code: '42501', message: 'not_allowed' } });
    mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2' }, error: null });
    const { MfaGate } = require('../src/features/admin/MfaGate');
    await render(
      <MfaGate>
        <AdminQueue />
      </MfaGate>,
    );
    await screen.findByText('Un message gênant');
    await fireEvent.changeText(screen.getAllByLabelText('Motif de la décision (obligatoire)')[0], 'Compte administrateur visé');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Avertir' })[0]);
    expect(await screen.findByText('Action refusée pour cet élément.')).toBeTruthy();
    expect(screen.queryByLabelText('Code à 6 chiffres')).toBeNull();
    expect(screen.getByText('Un message gênant')).toBeTruthy();
  });

  it('shows a specific message for an invalid statement', async () => {
    rpcHandlers.admin_decide_report = () => ({ data: null, error: { code: '23514', message: 'invalid_statement' } });
    await render(<AdminQueue />);
    await screen.findByText('Un message gênant');
    await fireEvent.changeText(screen.getAllByLabelText('Motif de la décision (obligatoire)')[0], 'Message de harcèlement avéré');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Avertir' })[0]);
    expect(await screen.findByText('Le motif doit faire entre 10 et 1000 caractères.')).toBeTruthy();
  });

  it('shows an error and keeps the item when the decision fails', async () => {
    rpcHandlers.admin_decide_report = () => ({ data: null, error: { message: 'boom', code: 'XX000' } });
    await render(<AdminQueue />);
    await screen.findByText('Un message gênant');
    await fireEvent.changeText(screen.getAllByLabelText('Motif de la décision (obligatoire)')[0], 'Message de harcèlement avéré');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Classer sans suite' })[0]);
    expect(await screen.findByText('Une erreur est survenue. Réessayez.')).toBeTruthy();
    expect(screen.getByText('Un message gênant')).toBeTruthy();
  });
});

describe('claims queue', () => {
  it('opens the signed URL of the document', async () => {
    mockParams = { queue: 'claims' };
    rpcHandlers.admin_claims = () => ({
      data: [
        {
          id: 'c1',
          status: 'pending',
          association: { id: 'a1', name: 'Club Photo', city: 'Lyon' },
          claimant_first_name: 'Zoe',
          role: 'Présidente',
          contact_email: null,
          has_document: true,
        },
      ],
      error: null,
    });
    rpcHandlers.admin_claim_document_path = () => ({ data: 'u1/doc.pdf', error: null });
    const createSignedUrl = jest.fn(async () => ({ data: { signedUrl: 'https://signed.example/doc' }, error: null }));
    storageFrom.mockReturnValue({ createSignedUrl });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    await render(<AdminQueue />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Voir le justificatif' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed.example/doc'));
    expect(storageFrom).toHaveBeenCalledWith('claim-documents');
    expect(createSignedUrl).toHaveBeenCalledWith('u1/doc.pdf', 300);
    expect(rpc).toHaveBeenCalledWith('admin_claim_document_path', { p_claim: 'c1' });
  });
});

describe('categories queue', () => {
  it('approves with the parent and the English name', async () => {
    mockParams = { queue: 'categories' };
    rpcHandlers.admin_category_requests = () => ({
      data: [{ id: 'q1', requested_name: 'Pétanque', created_at: '2026-10-24T10:00:00Z', requester_first_name: 'Paul' }],
      error: null,
    });
    rpcHandlers.admin_decide_category = () => ({ data: null, error: null });
    await render(<AdminQueue />);
    await screen.findByText('Pétanque');
    await fireEvent.press(screen.getByRole('button', { name: 'Approuver' }));
    const create = screen.getByRole('button', { name: 'Créer la catégorie' });
    expect(create.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Sport' }));
    await fireEvent.changeText(screen.getByLabelText('Nom en anglais'), 'Petanque');
    await fireEvent.press(screen.getByRole('button', { name: 'Créer la catégorie' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('admin_decide_category', {
        p_id: 'q1',
        p_action: 'approve',
        p_parent: 'root1',
        p_name_en: 'Petanque',
        p_into: null,
        p_note: null,
      }),
    );
    await waitFor(() => expect(screen.queryByText('Pétanque')).toBeNull());
  });

  it('offers root categories as parents, not sub-categories', async () => {
    mockParams = { queue: 'categories' };
    rpcHandlers.admin_category_requests = () => ({
      data: [{ id: 'q1', requested_name: 'Pétanque', created_at: 'x', requester_first_name: 'Paul' }],
      error: null,
    });
    await render(<AdminQueue />);
    await screen.findByText('Pétanque');
    await fireEvent.press(screen.getByRole('button', { name: 'Approuver' }));
    expect(await screen.findByRole('radio', { name: 'Culture' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Yoga' })).toBeNull();
  });
});

describe('clubs, feedback and home', () => {
  it('merges a club into the association picked from the search', async () => {
    mockParams = { queue: 'clubs' };
    rpcHandlers.admin_community_clubs = () => ({
      data: [{ id: 'k1', name: 'Les Boulistes', city: 'Nice', purpose: null, created_by_first_name: 'Jo', activity_count: 2 }],
      error: null,
    });
    rpcHandlers.admin_decide_club = () => ({ data: null, error: null });
    assocRows = [{ id: 'a9', name: 'Boule Niçoise', city: 'Nice' }];
    await render(<AdminQueue />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Fusionner' }));
    await fireEvent.changeText(screen.getByLabelText('Rechercher une association'), 'Boule');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Boule Niçoise, Nice' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmer la fusion' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('admin_decide_club', { p_id: 'k1', p_action: 'merge', p_into: 'a9', p_note: null }),
    );
  });

  it('rejects a club with a note', async () => {
    mockParams = { queue: 'clubs' };
    rpcHandlers.admin_community_clubs = () => ({
      data: [{ id: 'k1', name: 'Les Boulistes', city: 'Nice', purpose: null, created_by_first_name: 'Jo', activity_count: 0 }],
      error: null,
    });
    rpcHandlers.admin_decide_club = () => ({ data: null, error: null });
    await render(<AdminQueue />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Refuser' }));
    await fireEvent.changeText(screen.getByLabelText('Motif du refus'), 'court');
    expect(screen.getByRole('button', { name: 'Confirmer le refus' }).props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Motif du refus'), 'Club sans activité réelle');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmer le refus' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('admin_decide_club', { p_id: 'k1', p_action: 'reject', p_into: null, p_note: 'Club sans activité réelle' }),
    );
  });

  it('shows the limit message when the banned-word list is full', async () => {
    rpcHandlers.admin_set_banned_word = () => ({ data: null, error: { code: '42501', message: 'limit_reached' } });
    await render(<AdminHome />);
    await fireEvent.changeText(await screen.findByLabelText('Ajouter un mot'), 'abcdef');
    await fireEvent.press(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByText('Limite atteinte (500 mots).')).toBeTruthy();
  });

  it('adds a banned word once when pressed twice in the same tick', async () => {
    rpcHandlers.admin_set_banned_word = () => ({ data: null, error: null });
    await render(<AdminHome />);
    await fireEvent.changeText(await screen.findByLabelText('Ajouter un mot'), 'abcdef');
    const button = screen.getByRole('button', { name: 'Ajouter' });
    await act(async () => {
      void fireEvent.press(button);
      void fireEvent.press(button);
    });
    await screen.findByRole('button', { name: 'Retirer le mot abcdef' });
    expect(rpc.mock.calls.filter((c) => c[0] === 'admin_set_banned_word')).toHaveLength(1);
  });

  it('refreshes the counts when the screen regains focus', async () => {
    let open = 7;
    rpcHandlers.admin_reports = () => ({ data: { open_count: open, items: [] }, error: null });
    await render(<AdminHome />);
    await screen.findByRole('button', { name: 'Signalements, 7 en attente' });
    open = 3;
    await act(async () => {
      mockFocusCbs.forEach((cb) => cb());
    });
    expect(await screen.findByRole('button', { name: 'Signalements, 3 en attente' })).toBeTruthy();
  });

  it('shows 50+ when a list reached its cap', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, association: { name: 'A' }, role: 'r' }));
    rpcHandlers.admin_claims = () => ({ data: many, error: null });
    await render(<AdminHome />);
    expect(await screen.findByRole('button', { name: 'Revendications, 50+ en attente' })).toBeTruthy();
  });

  it('approves a club', async () => {
    mockParams = { queue: 'clubs' };
    rpcHandlers.admin_community_clubs = () => ({
      data: [{ id: 'k1', name: 'Les Boulistes', city: 'Nice', purpose: null, created_by_first_name: 'Jo', activity_count: 2 }],
      error: null,
    });
    rpcHandlers.admin_decide_club = () => ({ data: null, error: null });
    await render(<AdminQueue />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Approuver' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('admin_decide_club', { p_id: 'k1', p_action: 'approve', p_into: null, p_note: null }),
    );
  });

  it('changes the status of a feedback message', async () => {
    mockParams = { queue: 'feedback' };
    rpcHandlers.admin_feedback = () => ({
      data: [{ id: 'f1', type: 'idea', body: 'Ajoutez un mode sombre', status: 'new', screenshot_path: null, sender_first_name: 'Ana' }],
      error: null,
    });
    rpcHandlers.admin_set_feedback_status = () => ({ data: null, error: null });
    await render(<AdminQueue />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Prévu' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_set_feedback_status', { p_id: 'f1', p_status: 'planned' }));
  });

  it('shows the five queues with their counts and the banned words', async () => {
    rpcHandlers.admin_reports = () => ({ data: { open_count: 7, items: [] }, error: null });
    rpcHandlers.admin_claims = () => ({ data: [], error: null });
    await render(<AdminHome />);
    expect(await screen.findByRole('button', { name: 'Signalements, 7 en attente' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revendications, 0 en attente' })).toBeTruthy();
    for (const label of ['Clubs ajoutés', 'Catégories', 'Idées et problèmes']) {
      expect(await screen.findByRole('button', { name: `${label}, 0 en attente` })).toBeTruthy();
    }
    expect(screen.getByText('Mots interdits')).toBeTruthy();
  });

  it('adds a banned word', async () => {
    rpcHandlers.admin_set_banned_word = () => ({ data: null, error: null });
    await render(<AdminHome />);
    await fireEvent.changeText(await screen.findByLabelText('Ajouter un mot'), 'Merde');
    await fireEvent.press(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('admin_set_banned_word', { p_word: 'Merde', p_add: true }));
    expect(await screen.findByRole('button', { name: 'Retirer le mot merde' })).toBeTruthy();
  });
});

// Keeps the unused import honest for the Text-based mocks above.
void Text;
