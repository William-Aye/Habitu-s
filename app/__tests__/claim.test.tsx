import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import { ClaimForm } from '../src/features/claims/ClaimForm';
import {
  documentMimeType,
  linkCollectifToAssociation,
  myClaimStatus,
  myVerifiedAssociations,
  submitClaim,
} from '../src/features/claims/api';
import { initI18n } from '../src/i18n';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: class {
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  },
}));

const mockGetSession = jest.fn();
const mockInsert = jest.fn();
const mockUpload = jest.fn();
const mockRpc = jest.fn();
let mockRowsValue: { data: unknown; error: unknown } = { data: [], error: null };
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
    from: () => ({
      insert: (...a: unknown[]) => mockInsert(...a),
      select: () => {
        const b: any = {
          eq: () => b,
          in: () => b,
          then: (res: (v: unknown) => unknown) => Promise.resolve(mockRowsValue).then(res),
        };
        return b;
      },
    }),
    storage: { from: () => ({ upload: (...a: unknown[]) => mockUpload(...a) }) },
    rpc: (...a: unknown[]) => mockRpc(...a),
  },
}));

const mockGate = jest.fn();
jest.mock('../src/features/account/AccountGate', () => ({ useRequireAccount: () => mockGate }));

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockGate.mockResolvedValue(true);
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  mockInsert.mockResolvedValue({ error: null });
  mockUpload.mockResolvedValue({ error: null });
  mockRowsValue = { data: [], error: null };
});

const DOC = {
  canceled: false,
  assets: [{ uri: 'file:///statuts.pdf', name: 'statuts.pdf', mimeType: 'application/pdf' }],
};

describe('submitClaim', () => {
  it('sends the role and the e-mail as a domain_email proof', async () => {
    expect(await submitClaim({ associationId: 'a1', role: ' Présidente ', contactEmail: 'bureau@club.fr' })).toEqual({
      ok: true,
    });
    expect(mockInsert).toHaveBeenCalledWith({
      association_id: 'a1',
      claimant_id: 'u1',
      proof_method: 'domain_email',
      role_in_association: 'Présidente',
      contact_email: 'bureau@club.fr',
      document_path: null,
    });
  });

  it('uploads a document to <uid>/<uuid>.<ext> and files it as a document proof', async () => {
    await submitClaim({
      associationId: 'a1',
      role: 'Trésorier',
      documentUri: 'file:///statuts.pdf',
      documentMimeType: 'application/pdf',
    });
    const path = mockUpload.mock.calls[0][0] as string;
    expect(path).toMatch(/^u1\/[0-9a-f-]{36}\.pdf$/);
    expect(mockInsert.mock.calls[0][0]).toMatchObject({
      proof_method: 'document',
      document_path: path,
      contact_email: null,
    });
  });

  it('files nothing when the upload fails, and needs a session', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'x' } });
    const r = await submitClaim({ associationId: 'a1', role: 'Chef', documentUri: 'f', documentMimeType: 'image/png' });
    expect(r.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await submitClaim({ associationId: 'a1', role: 'Chef', contactEmail: 'a@b.fr' })).toEqual({
      ok: false,
      error: 'signed_out',
    });
  });
});

describe('claim errors and files', () => {
  it('maps a duplicate pending claim (23505) to duplicate', async () => {
    mockInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    expect(await submitClaim({ associationId: 'a1', role: 'Chef', contactEmail: 'a@b.fr' })).toEqual({
      ok: false,
      error: 'duplicate',
    });
  });

  it('refuses an unsupported document type and maps storage statuses', async () => {
    expect(
      await submitClaim({ associationId: 'a1', role: 'Chef', documentUri: 'f', documentMimeType: 'text/plain' }),
    ).toEqual({ ok: false, error: 'unsupported' });
    mockUpload.mockResolvedValue({ error: { message: 'big', statusCode: '413' } });
    expect(
      await submitClaim({ associationId: 'a1', role: 'Chef', documentUri: 'f', documentMimeType: 'image/png' }),
    ).toEqual({ ok: false, error: 'too_large' });
    mockUpload.mockResolvedValue({ error: { message: 'denied', statusCode: '403' } });
    expect(
      await submitClaim({ associationId: 'a1', role: 'Chef', documentUri: 'f', documentMimeType: 'image/png' }),
    ).toEqual({ ok: false, error: 'unknown' });
  });

  it('infers the type from the extension when the picker gives none', () => {
    expect(documentMimeType('Statuts.PDF', undefined)).toBe('application/pdf');
    expect(documentMimeType('a.jpeg', null)).toBe('image/jpeg');
    expect(documentMimeType('a.jpg', '')).toBe('image/jpeg');
    expect(documentMimeType('a.png', undefined)).toBe('image/png');
    expect(documentMimeType('a.docx', undefined)).toBeNull();
    expect(documentMimeType('a.pdf', 'application/pdf')).toBe('application/pdf');
  });

  it('reads my claim status on an association (approved wins)', async () => {
    mockRowsValue = { data: [{ status: 'pending' }, { status: 'approved' }], error: null };
    expect(await myClaimStatus('a1')).toBe('approved');
    mockRowsValue = { data: [{ status: 'pending' }], error: null };
    expect(await myClaimStatus('a1')).toBe('pending');
    mockRowsValue = { data: [], error: null };
    expect(await myClaimStatus('a1')).toBeNull();
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await myClaimStatus('a1')).toBeNull();
  });
});

describe('ClaimForm extras', () => {
  const PICK = 'Ou joindre un justificatif';

  it('shows the privacy notice', async () => {
    await render(<ClaimForm associationId="a1" onClose={jest.fn()} />);
    expect(
      await screen.findByText(
        'Votre justificatif sert uniquement à vérifier votre demande. Il est supprimé au plus tard un an après la décision.',
      ),
    ).toBeTruthy();
  });

  it('refuses a document above 10 MB, and one of an unknown type', async () => {
    await render(<ClaimForm associationId="a1" onClose={jest.fn()} />);
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'f', name: 'gros.pdf', mimeType: 'application/pdf', size: 10 * 1024 * 1024 + 1 }],
    });
    await fireEvent.press(await screen.findByLabelText(PICK));
    expect(await screen.findByText('Fichier trop volumineux (10 Mo maximum).')).toBeTruthy();
    expect(screen.queryByText(/Justificatif joint/)).toBeNull();
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'f', name: 'lettre.docx', size: 100 }],
    });
    await fireEvent.press(screen.getByLabelText(PICK));
    expect(await screen.findByText('Format non pris en charge (PDF, JPG ou PNG).')).toBeTruthy();
  });

  it('accepts a document without a MIME type when the extension is known', async () => {
    await render(<ClaimForm associationId="a1" onClose={jest.fn()} />);
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'f', name: 'statuts.PDF', size: 100 }],
    });
    await fireEvent.press(await screen.findByLabelText(PICK));
    expect(await screen.findByText('Justificatif joint : statuts.PDF')).toBeTruthy();
  });

  it('says so when a claim is already pending, and tells the page when sent', async () => {
    mockInsert.mockResolvedValueOnce({ error: { code: '23505', message: 'dup' } });
    const onSent = jest.fn();
    await render(<ClaimForm associationId="a1" onClose={jest.fn()} onSent={onSent} />);
    await fireEvent.changeText(await screen.findByLabelText("Votre rôle dans l'association"), 'Présidente');
    await fireEvent.changeText(screen.getByLabelText("Adresse e-mail de l'association"), 'bureau@club.fr');
    await fireEvent.press(screen.getByLabelText('Envoyer la demande'));
    expect(await screen.findByText('Vous avez déjà une demande en cours pour cette association.')).toBeTruthy();
    expect(onSent).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Envoyer la demande'));
    await screen.findByText('Demande envoyée. Nous vous répondrons sous quelques jours.');
    expect(onSent).toHaveBeenCalledTimes(1);
  });
});

describe('ClaimForm', () => {
  const ROLE = "Votre rôle dans l'association";
  const EMAIL = "Adresse e-mail de l'association";
  const send = () => screen.getByLabelText('Envoyer la demande');
  const disabled = (el: { props: any }) => el.props.accessibilityState?.disabled === true;

  it('asks for an account first (reason join) and shows nothing without one', async () => {
    mockGate.mockResolvedValue(false);
    const onClose = jest.fn();
    await render(<ClaimForm associationId="a1" onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockGate).toHaveBeenCalledWith('join');
    expect(screen.queryByLabelText(ROLE)).toBeNull();
  });

  it('requires a role and an e-mail or a document', async () => {
    await render(<ClaimForm associationId="a1" onClose={jest.fn()} />);
    const role = await screen.findByLabelText(ROLE);
    expect(disabled(send())).toBe(true);
    await fireEvent.changeText(role, 'Présidente');
    expect(disabled(send())).toBe(true);
    await fireEvent.changeText(screen.getByLabelText(EMAIL), 'pas-un-mail');
    expect(disabled(send())).toBe(true);
    await fireEvent.changeText(screen.getByLabelText(EMAIL), 'bureau@club.fr');
    expect(disabled(send())).toBe(false);
    await fireEvent.changeText(screen.getByLabelText(EMAIL), '');
    expect(disabled(send())).toBe(true);
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue(DOC);
    await fireEvent.press(screen.getByLabelText('Ou joindre un justificatif'));
    await screen.findByText('Justificatif joint : statuts.pdf');
    expect(disabled(send())).toBe(false);
  });

  it('sends the role once and shows the confirmation', async () => {
    await render(<ClaimForm associationId="a1" onClose={jest.fn()} />);
    await fireEvent.changeText(await screen.findByLabelText(ROLE), 'Présidente');
    await fireEvent.changeText(screen.getByLabelText(EMAIL), 'bureau@club.fr');
    const button = send();
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(await screen.findByText('Demande envoyée. Nous vous répondrons sous quelques jours.')).toBeTruthy();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0].role_in_association).toBe('Présidente');
  });
});

describe('collectif link api', () => {
  it('lists my verified associations from my approved claims', async () => {
    mockRowsValue = {
      data: [
        { association_id: 'a1', associations: { id: 'a1', name: 'Club Boules' } },
        { association_id: 'a1', associations: { id: 'a1', name: 'Club Boules' } },
      ],
      error: null,
    };
    expect(await myVerifiedAssociations()).toEqual({ ok: true, associations: [{ id: 'a1', name: 'Club Boules' }] });
  });

  it('calls the RPC with both ids', async () => {
    mockRpc.mockResolvedValue({ data: 3, error: null });
    expect(await linkCollectifToAssociation('c1', 'a1')).toEqual({ ok: true, moved: 3 });
    expect(mockRpc).toHaveBeenCalledWith('link_collectif_to_association', { p_collectif: 'c1', p_association: 'a1' });
  });
});
