import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { ShieldCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { AdminButton } from './buttons';

const AdminLockContext = createContext<() => void>(() => {});

/** Called when the server refuses an admin call: the admin goes back to the code screen. */
export function useAdminLock() {
  return useContext(AdminLockContext);
}

type Phase =
  | { name: 'loading' }
  | { name: 'error' }
  | { name: 'enroll'; factorId: string; qr: string; secret: string }
  | { name: 'verify'; factorId: string }
  | { name: 'ok' };

/** Supabase returns the QR code as an SVG data URI ("data:image/svg+xml;utf-8,<svg...") or as raw SVG. */
export function qrToSvg(qr: string): string {
  if (qr.trimStart().startsWith('<')) return qr;
  const body = qr.slice(qr.indexOf(',') + 1);
  try {
    return decodeURIComponent(body);
  } catch {
    return body;
  }
}

async function findPhase(): Promise<Phase> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return { name: 'error' };
  const verified = data?.totp?.[0];
  if (verified) {
    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) return { name: 'error' };
    return aal?.currentLevel === 'aal2' ? { name: 'ok' } : { name: 'verify', factorId: verified.id };
  }
  // A half-finished enrolment would block a new one with the same name.
  for (const f of data?.all ?? []) {
    if (f.factor_type === 'totp' && f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data: enrolled, error: enrolError } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
  if (enrolError || !enrolled?.totp) return { name: 'error' };
  return { name: 'enroll', factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret };
}

export function MfaGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [version, setVersion] = useState(0);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const forced = useRef(false);

  useEffect(() => {
    let active = true;
    findPhase()
      .then((p) => {
        // After a refusal the server's word beats the local token: the code is asked again.
        if (forced.current && p.name === 'ok') {
          return supabase.auth.mfa.listFactors().then(({ data }) => {
            const id = data?.totp?.[0]?.id;
            if (active) setPhase(id ? { name: 'verify', factorId: id } : { name: 'error' });
          });
        }
        if (active) setPhase(p);
      })
      .catch(() => active && setPhase({ name: 'error' }));
    return () => {
      active = false;
    };
  }, [version]);

  const lock = useCallback(() => {
    forced.current = true;
    setCode('');
    setWrong(false);
    setPhase({ name: 'loading' });
    setVersion((v) => v + 1);
  }, []);

  const submit = async (factorId: string) => {
    if (busy) return;
    setBusy(true);
    setWrong(false);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId });
      if (challenge.error || !challenge.data) throw new Error('challenge');
      const verified = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: code.trim() });
      if (verified.error) throw new Error('verify');
      forced.current = false;
      setCode('');
      setPhase({ name: 'ok' });
    } catch {
      setWrong(true);
    } finally {
      setBusy(false);
    }
  };

  if (phase.name === 'ok') return <AdminLockContext.Provider value={lock}>{children}</AdminLockContext.Provider>;
  if (phase.name === 'loading') {
    return <ActivityIndicator style={styles.center} accessibilityLabel={t('admin.loading')} />;
  }
  if (phase.name === 'error') {
    return (
      <View style={styles.center}>
        <Text accessibilityLiveRegion="polite">{t('admin.errors.unknown')}</Text>
        <AdminButton
          label={t('admin.retry')}
          onPress={() => {
            setPhase({ name: 'loading' });
            setVersion((v) => v + 1);
          }}
        />
      </View>
    );
  }

  const enrolling = phase.name === 'enroll';
  return (
    <View style={styles.screen}>
      <ShieldCheck size={32} color="#1a56db" />
      <Text accessibilityRole="header" style={styles.title}>
        {enrolling ? t('admin.mfa.enrollTitle') : t('admin.mfa.verifyTitle')}
      </Text>
      {enrolling ? (
        <>
          <Text>{t('admin.mfa.enrollIntro')}</Text>
          <View accessible accessibilityLabel={t('admin.mfa.qrAlt')} style={styles.qr}>
            <SvgXml xml={qrToSvg(phase.qr)} width={200} height={200} />
          </View>
          <Text>{t('admin.mfa.secretLabel')}</Text>
          <Text selectable style={styles.secret}>{phase.secret}</Text>
        </>
      ) : (
        <Text>{t('admin.mfa.verifyIntro')}</Text>
      )}
      <TextInput
        accessibilityLabel={t('admin.mfa.code')}
        placeholder={t('admin.mfa.code')}
        style={styles.input}
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        editable={!busy}
      />
      {wrong ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>{t('admin.mfa.wrong')}</Text>
      ) : null}
      <AdminButton
        variant="primary"
        label={t('admin.mfa.verify')}
        busy={busy}
        disabled={code.length !== 6}
        onPress={() => submit(phase.factorId)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 12, justifyContent: 'center', backgroundColor: '#fff' },
  center: { marginTop: 80, padding: 16, alignItems: 'center', gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  qr: { alignSelf: 'center', padding: 8, backgroundColor: '#fff' },
  secret: { fontFamily: 'monospace', fontSize: 16, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#9ca3af', borderRadius: 8, padding: 12, fontSize: 20, letterSpacing: 4, minHeight: 48 },
  error: { color: '#b91c1c' },
});
