import { router, type Href } from 'expo-router';
import { Check, Mail, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useExploreLocation } from '../explore/useExploreLocation';
import {
  completeProfile,
  MAX_FIRST_NAME,
  signOut,
  sendEmailCode,
  signInWithGoogle,
  verifyEmailCode,
  type AuthError,
} from './auth';
import { resolveHomeArea } from './homeArea';
import { Turnstile } from './Turnstile';
import { useSession } from './useSession';
import type { GateReason } from './AccountGate';

type Step = 'choose' | 'code' | 'profile';
type ErrorKey = AuthError | 'invalidEmail' | 'first_name' | 'age';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignUpSheet({
  reason,
  onClose,
  onSignedUp,
}: {
  /** Omitted when the user chose to sign in from Profil: no reason sentence is shown. */
  reason?: GateReason;
  /** `true` when the user ends up signed in with a complete profile, `false` if dismissed. */
  onClose(ready: boolean): void;
  onSignedUp?: (userId: string) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const { location } = useExploreLocation();

  const [chosenStep, setStep] = useState<Step>('choose');
  // A signed-in user without a complete profile always sees the profile step.
  const step: Step = session.status === 'needs_profile' ? 'profile' : chosenStep;
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState(session.profile?.firstName ?? '');
  const [ageOk, setAgeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  // The account step worked but the session could not be settled (network): retry only the refresh.
  const [syncFailed, setSyncFailed] = useState(false);
  const [captchaFailed, setCaptchaFailed] = useState(false);

  const hookRan = useRef(false);
  const closed = useRef(false);

  const close = useCallback(
    (ready: boolean) => {
      if (closed.current) return;
      closed.current = true;
      onClose(ready);
    },
    [onClose],
  );

  const runHook = useCallback(
    async (userId: string | null) => {
      if (hookRan.current || !userId) return;
      hookRan.current = true;
      try {
        await onSignedUp?.(userId);
      } catch (e) {
        console.warn('post sign-up hook failed', e);
      }
    },
    [onSignedUp],
  );

  // A complete profile ends the flow.
  const { status, userId } = session;
  useEffect(() => {
    if (status === 'ready') {
      runHook(userId).then(() => close(true));
    }
  }, [status, userId, runHook, close]);

  const onToken = useCallback((tk: string) => {
    setToken(tk);
    setCaptchaFailed(false);
  }, []);
  const onCaptchaError = useCallback(() => {
    setToken(null);
    setCaptchaFailed(true);
  }, []);
  const freshCaptcha = () => {
    setToken(null);
    setCaptchaKey((k) => k + 1);
  };
  const retryCaptcha = () => {
    setError(null);
    setCaptchaFailed(false);
    freshCaptcha();
  };

  const showError = (e: ErrorKey | null) => setError(e === 'cancelled' ? null : e);

  async function onGoogle() {
    setBusy(true);
    setError(null);
    const res = await signInWithGoogle();
    if (res.ok) {
      if ('givenName' in res && res.givenName) setFirstName((cur) => cur || (res.givenName ?? ''));
      await settle();
    } else {
      showError(res.error);
    }
    setBusy(false);
  }

  /** Re-reads the session; if it cannot be settled, offers a retry that never repeats the used step. */
  async function settle() {
    const st = await session.refresh();
    setSyncFailed(st === 'loading');
  }

  async function onRetrySync() {
    setBusy(true);
    await settle();
    setBusy(false);
  }

  async function sendCode(value: string): Promise<boolean> {
    if (token === null) return false;
    setBusy(true);
    setError(null);
    const res = await sendEmailCode(value, token);
    if (!res.ok) showError(res.error);
    freshCaptcha(); // a Turnstile token is single use
    setBusy(false);
    return res.ok;
  }

  async function onSendCode() {
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError('invalidEmail');
      return;
    }
    if (await sendCode(value)) {
      setSentTo(value);
      setCode('');
      setStep('code');
    }
  }

  async function onVerify() {
    setBusy(true);
    setError(null);
    const res = await verifyEmailCode(sentTo, code.trim());
    if (res.ok) await settle();
    else showError(res.error);
    setBusy(false);
  }

  async function onSubmitProfile() {
    setBusy(true);
    setError(null);
    const homeArea = await resolveHomeArea(location);
    const res = await completeProfile({
      firstName,
      ageConfirmed: true,
      language: i18n.language?.startsWith('en') ? 'en' : 'fr',
      homeArea,
    });
    if (res.ok) {
      await runHook(session.userId);
      await settle();
    } else {
      showError(res.error);
    }
    setBusy(false);
  }

  function openPrivacy() {
    close(false);
    router.push('/privacy' as Href);
  }

  const profileValid = firstName.trim().length > 0 && firstName.trim().length <= MAX_FIRST_NAME && ageOk;
  const captchaPending = token === null && !captchaFailed;
  const captchaBlocked = captchaFailed || error === 'captcha'; // retry is the only action

  return (
    <Modal transparent animationType="slide" visible onRequestClose={() => close(false)}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('account.close')}
              style={styles.close}
              onPress={() => close(false)}
            >
              <X size={18} color="#1a56db" />
              <Text style={styles.linkText}>{t('account.close')}</Text>
            </Pressable>

            <Text accessibilityRole="header" style={styles.title}>
              {t('account.title')}
            </Text>
            {reason ? <Text style={styles.reason}>{t(`account.reasons.${reason}`)}</Text> : null}

            {step === 'choose' ? (
              <View style={styles.group}>
                <Button
                  label={t('account.google')}
                  onPress={onGoogle}
                  disabled={busy}
                  secondary
                />
                <Text style={styles.or}>{t('account.or')}</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  editable={!busy}
                  accessibilityLabel={t('account.emailLabel')}
                  placeholder={t('account.emailLabel')}
                />
                <Button
                  label={t('account.sendCode')}
                  onPress={onSendCode}
                  disabled={busy || captchaPending || captchaBlocked}
                  icon={<Mail size={18} color="#fff" />}
                />
              </View>
            ) : null}

            {step === 'code' ? (
              <View style={styles.group}>
                <Text style={styles.label}>{t('account.codeSent', { email: sentTo })}</Text>
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  editable
                  accessibilityLabel={t('account.codeLabel')}
                  placeholder={t('account.codeLabel')}
                />
                <Button
                  label={t('account.validate')}
                  onPress={onVerify}
                  disabled={busy || code.length !== 6 || syncFailed}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('account.resend')}
                  accessibilityState={{ disabled: busy || captchaPending }}
                  disabled={busy || captchaPending}
                  style={styles.linkButton}
                  onPress={() => {
                    void sendCode(sentTo);
                  }}
                >
                  <Text style={styles.linkText}>{t('account.resend')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('account.changeEmail')}
                  style={styles.linkButton}
                  onPress={() => {
                    setError(null);
                    setSyncFailed(false);
                    setStep('choose');
                  }}
                >
                  <Text style={styles.linkText}>{t('account.changeEmail')}</Text>
                </Pressable>
              </View>
            ) : null}

            {step === 'profile' ? (
              <View style={styles.group}>
                <Text style={styles.label}>{t('account.firstName')}</Text>
                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  maxLength={MAX_FIRST_NAME}
                  autoComplete="given-name"
                  textContentType="givenName"
                  editable={!busy}
                  accessibilityLabel={t('account.firstName')}
                />
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={t('account.age')}
                  accessibilityState={{ checked: ageOk }}
                  style={styles.checkRow}
                  onPress={() => setAgeOk((v) => !v)}
                >
                  <View style={[styles.box, ageOk && styles.boxChecked]}>
                    {ageOk ? <Check size={16} color="#fff" /> : null}
                  </View>
                  <Text style={styles.checkText}>{t('account.age')}</Text>
                </Pressable>
                <Button
                  label={t('account.validate')}
                  onPress={onSubmitProfile}
                  disabled={busy || !profileValid}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.signOut')}
                  style={styles.linkButton}
                  onPress={() => {
                    void signOut();
                    close(false);
                  }}
                >
                  <Text style={styles.linkText}>{t('profile.signOut')}</Text>
                </Pressable>
              </View>
            ) : null}

            {syncFailed && !error ? (
              <>
                <Text accessibilityRole="alert" style={styles.error}>
                  {t('account.errors.network')}
                </Text>
                <Button label={t('account.retry')} onPress={onRetrySync} disabled={busy} secondary />
              </>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {t(`account.errors.${error}`)}
              </Text>
            ) : null}
            {captchaFailed || error === 'captcha' ? (
              <Button label={t('account.retry')} onPress={retryCaptcha} secondary />
            ) : null}

            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t('account.privacy')}
              style={styles.linkButton}
              onPress={openPrivacy}
            >
              <Text style={styles.linkText}>{t('account.privacy')}</Text>
            </Pressable>
          </ScrollView>
          {step !== 'profile' ? (
            <Turnstile key={captchaKey} onToken={onToken} onError={onCaptchaError} />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Button({
  label,
  onPress,
  disabled,
  secondary,
  icon,
}: {
  label: string;
  onPress(): void | Promise<void>;
  disabled?: boolean;
  secondary?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}
      onPress={() => {
        void onPress();
      }}
    >
      {icon}
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  content: { padding: 20, gap: 12 },
  close: {
    alignSelf: 'flex-end',
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  title: { fontSize: 22, fontWeight: '700' },
  reason: { fontSize: 15, color: '#444' },
  group: { gap: 12 },
  or: { textAlign: 'center', color: '#666' },
  label: { fontSize: 15, fontWeight: '600' },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 24,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  button: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: '#1a56db',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  secondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#1a56db' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryText: { color: '#1a56db' },
  linkButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: '#1a56db', fontSize: 15, fontWeight: '600' },
  error: { color: '#a00', fontSize: 14 },
  checkRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: '#1a56db' },
  checkText: { fontSize: 16 },
});
