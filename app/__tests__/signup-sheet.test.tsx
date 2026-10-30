import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking, Pressable, Text } from 'react-native';
import { AccountGateProvider, useRequireAccount } from '../src/features/account/AccountGate';
import * as auth from '../src/features/account/auth';
import { initI18n } from '../src/i18n';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, Link: 'Link' }));
jest.mock('../src/features/account/auth');
jest.mock('../src/features/explore/useExploreLocation', () => ({
  useExploreLocation: () => ({ location: null, status: 'needed', requestGps: jest.fn(), setTown: jest.fn() }),
}));
jest.mock('../src/features/account/Turnstile', () => {
  const React = require('react');
  return {
    Turnstile: ({ onToken }: { onToken(t: string): void }) => {
      React.useEffect(() => {
        onToken('tok');
      }, [onToken]);
      return null;
    },
  };
});
jest.mock('../src/features/account/useSession', () => {
  const React = require('react');
  const store = { value: null as unknown, listeners: new Set<() => void>() };
  return {
    __store: store,
    useSession: () =>
      React.useSyncExternalStore(
        (cb: () => void) => {
          store.listeners.add(cb);
          return () => store.listeners.delete(cb);
        },
        () => store.value,
      ),
  };
});

jest.setTimeout(60000);

type Session = {
  status: 'loading' | 'signed_out' | 'needs_profile' | 'ready';
  userId: string | null;
  profile: null;
  refresh: jest.Mock;
};
const store = (jest.requireMock('../src/features/account/useSession') as {
  __store: { value: Session; listeners: Set<() => void> };
}).__store;

async function setSession(patch: Partial<Session>) {
  await act(async () => {
    store.value = { ...store.value, ...patch };
    store.listeners.forEach((l) => l());
  });
}

const mocked = auth as jest.Mocked<typeof auth>;

let result: boolean | undefined;
function Harness({ reason = 'wait' as const }) {
  const requireAccount = useRequireAccount();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        // Not awaited: fireEvent would otherwise wait for the sheet to close.
        requireAccount(reason).then((r) => {
          result = r;
        });
      }}
    >
      <Text>ouvrir</Text>
    </Pressable>
  );
}

async function open(status: Session['status'] = 'signed_out', onSignedUp = jest.fn(async () => {})) {
  store.value = { status, userId: status === 'signed_out' ? null : 'u1', profile: null, refresh: jest.fn(async () => {}) };
  result = undefined;
  await render(
    <AccountGateProvider onSignedUp={onSignedUp}>
      <Harness />
    </AccountGateProvider>,
  );
  await fireEvent.press(screen.getByText('ouvrir'));
  return onSignedUp;
}

const isDisabled = (el: { props: Record<string, any> }) =>
  el.props.accessibilityState?.disabled === true || el.props['aria-disabled'] === true;

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.resetAllMocks();
});

async function typeEmail(value: string) {
  await fireEvent.changeText(screen.getByLabelText('Adresse e-mail'), value);
}

it('shows the reason sentence and the sign-up title', async () => {
  await open();
  expect(await screen.findByText('Créez votre compte en 1 minute')).toBeTruthy();
  expect(screen.getByText('Créez un compte pour être prévenu')).toBeTruthy();
  expect(screen.getByText('Continuer avec Google')).toBeTruthy();
  expect(screen.getByText('Politique de confidentialité')).toBeTruthy();
});

it('shows the legal notice with links to the terms and the privacy policy', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const push = (jest.requireMock('expo-router') as { router: { push: jest.Mock } }).router.push;
  await open();
  expect(
    await screen.findByText(
      "En continuant, vous acceptez les conditions d'utilisation et la politique de confidentialité.",
    ),
  ).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Conditions d'utilisation"));
  expect(openURL).toHaveBeenCalledWith(expect.stringMatching(/\/conditions$/));
  await fireEvent.press(screen.getByLabelText('Politique de confidentialité'));
  expect(push).toHaveBeenCalledWith('/privacy');
});

it('rejects an invalid email without sending anything', async () => {
  await open();
  await typeEmail('pas-un-email');
  await fireEvent.press(screen.getByText('Recevoir un code par e-mail'));
  expect(await screen.findByText('Adresse e-mail invalide')).toBeTruthy();
  expect(mocked.sendEmailCode).not.toHaveBeenCalled();
});

it('sends the code with the captcha token and moves to the code step', async () => {
  mocked.sendEmailCode.mockResolvedValue({ ok: true });
  await open();
  await typeEmail('ana@exemple.fr');
  await fireEvent.press(screen.getByText('Recevoir un code par e-mail'));
  expect(await screen.findByText('Entrez le code reçu à ana@exemple.fr')).toBeTruthy();
  expect(mocked.sendEmailCode).toHaveBeenCalledWith('ana@exemple.fr', 'tok');
});

async function toCodeStep() {
  mocked.sendEmailCode.mockResolvedValue({ ok: true });
  await open();
  await typeEmail('ana@exemple.fr');
  await fireEvent.press(screen.getByText('Recevoir un code par e-mail'));
  await screen.findByText('Entrez le code reçu à ana@exemple.fr');
}

it.each([
  ['invalid_code', 'Code incorrect. Vérifiez et réessayez.'],
  ['expired_code', 'Ce code a expiré. Demandez-en un nouveau.'],
] as const)('shows %s and keeps the code field editable', async (error, message) => {
  await toCodeStep();
  mocked.verifyEmailCode.mockResolvedValue({ ok: false, error });
  await fireEvent.changeText(screen.getByLabelText('Code à 8 chiffres'), '12345678');
  await fireEvent.press(screen.getByText('Valider'));
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.getByLabelText('Code à 8 chiffres').props.editable).not.toBe(false);
});

it('offers a retry after a captcha failure', async () => {
  mocked.sendEmailCode.mockResolvedValue({ ok: false, error: 'captcha' });
  await open();
  await typeEmail('ana@exemple.fr');
  await fireEvent.press(screen.getByText('Recevoir un code par e-mail'));
  expect(await screen.findByText('La vérification de sécurité a échoué.')).toBeTruthy();
  expect(screen.getByText('Réessayer')).toBeTruthy();
  const send = screen.getByRole('button', { name: 'Recevoir un code par e-mail' });
  expect(isDisabled(send)).toBe(true);
});

it('after a verified code with an unsettled session, shows a network message and retries only the refresh', async () => {
  await toCodeStep();
  mocked.verifyEmailCode.mockResolvedValue({ ok: true });
  store.value.refresh.mockResolvedValueOnce('loading');
  await fireEvent.changeText(screen.getByLabelText('Code à 8 chiffres'), '12345678');
  await fireEvent.press(screen.getByText('Valider'));
  expect(await screen.findByText('Pas de connexion. Vérifiez votre réseau et réessayez.')).toBeTruthy();
  store.value.refresh.mockImplementation(async () => {
    await setSession({ status: 'needs_profile', userId: 'u1' });
    return 'needs_profile';
  });
  await fireEvent.press(screen.getByText('Réessayer'));
  expect(await screen.findByLabelText('Votre prénom')).toBeTruthy();
  expect(mocked.verifyEmailCode).toHaveBeenCalledTimes(1);
});

it('keeps Valider disabled while the sync retry is pending, and a new email resets that state', async () => {
  await toCodeStep();
  mocked.verifyEmailCode.mockResolvedValue({ ok: true });
  store.value.refresh.mockResolvedValueOnce('loading');
  await fireEvent.changeText(screen.getByLabelText('Code à 8 chiffres'), '12345678');
  await fireEvent.press(screen.getByText('Valider'));
  expect(await screen.findByText('Réessayer')).toBeTruthy();
  expect(isDisabled(screen.getByRole('button', { name: 'Valider' }))).toBe(true);
  await fireEvent.press(screen.getByText("Modifier l'adresse"));
  expect(screen.queryByText('Pas de connexion. Vérifiez votre réseau et réessayez.')).toBeNull();
  expect(screen.queryByText('Réessayer')).toBeNull();
});

it('disables the button while a request is pending and re-enables it after', async () => {
  let resolve!: (v: { ok: false; error: 'network' }) => void;
  mocked.sendEmailCode.mockReturnValue(new Promise((r) => (resolve = r)));
  await open();
  await typeEmail('ana@exemple.fr');
  await fireEvent.press(screen.getByText('Recevoir un code par e-mail'));
  const button = () => screen.getByRole('button', { name: 'Recevoir un code par e-mail' });
  await waitFor(() => expect(isDisabled(button())).toBe(true));
  await act(async () => resolve({ ok: false, error: 'network' }));
  await waitFor(() => expect(isDisabled(button())).toBe(false));
  expect(await screen.findByText(/connexion/i)).toBeTruthy();
});

describe('profile step', () => {
  it('opens on the first-name step when the profile is incomplete', async () => {
    await open('needs_profile');
    expect(await screen.findByLabelText('Votre prénom')).toBeTruthy();
    expect(screen.queryByText('Continuer avec Google')).toBeNull();
  });

  it('keeps Valider disabled until a first name and the 18+ box are set', async () => {
    await open('needs_profile');
    const valider = () => screen.getByRole('button', { name: 'Valider' });
    expect(isDisabled(valider())).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Votre prénom'), '   ');
    await fireEvent.press(screen.getByText("J'ai 18 ans ou plus"));
    expect(isDisabled(valider())).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Votre prénom'), 'Ana');
    expect(isDisabled(valider())).toBe(false);
    await fireEvent.press(screen.getByText("J'ai 18 ans ou plus"));
    expect(isDisabled(valider())).toBe(true);
  });

  it('offers a sign-out link on the profile step', async () => {
    await open('needs_profile');
    await fireEvent.press(await screen.findByText('Se déconnecter'));
    expect(mocked.signOut).toHaveBeenCalledTimes(1);
  });

  it('Google without a given name lands on an empty first-name step', async () => {
    mocked.signInWithGoogle.mockResolvedValue({ ok: true });
    await open();
    await fireEvent.press(screen.getByText('Continuer avec Google'));
    await setSession({ status: 'needs_profile', userId: 'u1' });
    const field = await screen.findByLabelText('Votre prénom');
    expect(field.props.value ?? '').toBe('');
  });

  it('Google with a given name pre-fills the first name', async () => {
    mocked.signInWithGoogle.mockResolvedValue({ ok: true, givenName: 'Ana' });
    await open();
    await fireEvent.press(screen.getByText('Continuer avec Google'));
    await setSession({ status: 'needs_profile', userId: 'u1' });
    expect((await screen.findByLabelText('Votre prénom')).props.value).toBe('Ana');
  });
});

describe('requireAccount', () => {
  it('waits for a loading session to settle before deciding', async () => {
    await open('loading');
    expect(screen.queryByText('Créez votre compte en 1 minute')).toBeNull();
    await setSession({ status: 'ready', userId: 'u1' });
    await waitFor(() => expect(result).toBe(true));
    expect(screen.queryByText('Créez votre compte en 1 minute')).toBeNull();
  });

  it('opens the sheet when the session is still loading after 5 seconds', async () => {
    jest.useFakeTimers();
    try {
      await open('loading');
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5200);
      });
      expect(screen.getByText('Créez votre compte en 1 minute')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('resolves true at once when already ready', async () => {
    await open('ready');
    await waitFor(() => expect(result).toBe(true));
    expect(screen.queryByText('Créez votre compte en 1 minute')).toBeNull();
  });

  it('resolves false when the sheet is dismissed', async () => {
    await open();
    await fireEvent.press(await screen.findByLabelText('Fermer'));
    await waitFor(() => expect(result).toBe(false));
  });

  it('resolves true and runs the sign-up hook after a completed profile', async () => {
    mocked.completeProfile.mockResolvedValue({ ok: true });
    const onSignedUp = await open('needs_profile');
    store.value.refresh.mockImplementation(async () => {
      await setSession({ status: 'ready' });
    });
    await fireEvent.changeText(await screen.findByLabelText('Votre prénom'), '  Ana ');
    await fireEvent.press(screen.getByText("J'ai 18 ans ou plus"));
    await fireEvent.press(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(result).toBe(true));
    expect(mocked.completeProfile).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: '  Ana ', ageConfirmed: true, language: 'fr' }),
    );
    expect(onSignedUp).toHaveBeenCalledWith('u1');
  });
});

it('AUTH-3: the code field takes eight digits, drops other characters, and Valider needs all eight', async () => {
  await toCodeStep();
  const field = screen.getByLabelText('Code à 8 chiffres');
  await fireEvent.changeText(field, '12ab34567890');
  expect(screen.getByLabelText('Code à 8 chiffres').props.value).toBe('12345678');
  await fireEvent.changeText(field, '1234567');
  expect(screen.getByRole('button', { name: 'Valider' }).props.accessibilityState?.disabled ?? screen.getByRole('button', { name: 'Valider' }).props.disabled).toBeTruthy();
  await fireEvent.changeText(field, '12345678');
  mocked.verifyEmailCode.mockResolvedValue({ ok: false, error: 'invalid_code' });
  await fireEvent.press(screen.getByText('Valider'));
  expect(mocked.verifyEmailCode).toHaveBeenCalledWith('ana@exemple.fr', '12345678');
});
