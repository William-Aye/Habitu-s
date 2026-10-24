import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { ImagePlus, X } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Turnstile } from '../account/Turnstile';
import { useSession } from '../account/useSession';
import { MAX_FEEDBACK, sendFeedback, type FeedbackType } from './api';

const TYPES: FeedbackType[] = ['idea', 'problem', 'other'];

/**
 * "Une idée ? Un problème ?": a type, a message and, for signed-in people, a screenshot. Signing in is not
 * required: a signed-out sender goes through the invisible Turnstile check.
 */
export function FeedbackForm({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation();
  const { userId } = useSession();
  const [type, setType] = useState<FeedbackType>('idea');
  const [body, setBody] = useState('');
  const [shot, setShot] = useState<{ uri: string; width?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'sent' | 'limit' | 'captcha' | 'error' | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaFailed, setCaptchaFailed] = useState(false);
  // Set synchronously: two presses in the same tick must send one message.
  const sending = useRef(false);

  const onToken = useCallback((tk: string) => {
    setToken(tk);
    setCaptchaFailed(false);
  }, []);
  const onCaptchaError = useCallback(() => {
    setToken(null);
    setCaptchaFailed(true);
  }, []);
  // A Turnstile token is single use.
  const freshCaptcha = () => {
    setToken(null);
    setCaptchaKey((k) => k + 1);
  };

  const trimmed = body.trim();
  const signedOut = !userId;
  const ready = trimmed.length > 0 && trimmed.length <= MAX_FEEDBACK && (!signedOut || token !== null);

  const pickShot = async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images' });
      if (!r.canceled && r.assets?.[0]) setShot({ uri: r.assets[0].uri, width: r.assets[0].width });
    } catch {
      // Picking is optional: nothing to report when the library cannot be opened.
    }
  };

  const send = async () => {
    if (sending.current || !ready) return;
    sending.current = true;
    setBusy(true);
    setOutcome(null);
    const r = await sendFeedback({
      type,
      body: trimmed,
      screenshotUri: userId ? shot?.uri : undefined,
      screenshotWidth: shot?.width,
      turnstileToken: signedOut ? (token ?? '') : undefined,
    });
    sending.current = false;
    setBusy(false);
    if (r.ok) return setOutcome('sent');
    if (signedOut) freshCaptcha();
    setOutcome(r.error === 'limit_reached' ? 'limit' : r.error === 'captcha' ? 'captcha' : 'error');
  };

  const close = () => (onDone ? onDone() : router.back());

  if (outcome === 'sent') {
    return (
      <View style={styles.content}>
        <Text accessibilityLiveRegion="polite" style={styles.ok}>{t('feedback.thanks')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('feedback.close')}
          style={styles.primary}
          onPress={close}
        >
          <Text style={styles.primaryText}>{t('feedback.close')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View accessibilityRole="radiogroup" accessibilityLabel={t('feedback.typeLabel')} style={styles.types}>
        {TYPES.map((k) => {
          const label = t(`feedback.types.${k}`);
          const selected = type === k;
          return (
            <Pressable
              key={k}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected, disabled: busy }}
              disabled={busy}
              style={[styles.choice, selected && styles.choiceOn]}
              onPress={() => setType(k)}
            >
              <Text style={selected ? styles.choiceOnText : styles.choiceText}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        accessibilityLabel={t('feedback.body')}
        placeholder={t('feedback.body')}
        multiline
        maxLength={MAX_FEEDBACK}
        value={body}
        editable={!busy}
        onChangeText={setBody}
        style={styles.input}
      />
      <Text style={styles.hint}>{t('feedback.count', { n: body.length, max: MAX_FEEDBACK })}</Text>

      {userId ? (
        shot ? (
          <View style={styles.row}>
            <Text style={styles.flex}>{t('feedback.screenshotAdded')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('feedback.removeScreenshot')}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={styles.iconButton}
              onPress={() => setShot(null)}
            >
              <X size={20} color="#1a56db" />
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('feedback.addScreenshot')}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={[styles.outline, styles.withIcon]}
            onPress={pickShot}
          >
            <ImagePlus size={18} color="#1a56db" />
            <Text style={styles.outlineText}>{t('feedback.addScreenshot')}</Text>
          </Pressable>
        )
      ) : null}

      {outcome ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {t(`feedback.${outcome}`)}
        </Text>
      ) : null}
      {signedOut && captchaFailed ? (
        <View accessibilityLiveRegion="polite">
          <Text style={styles.error}>{t('feedback.captcha')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('explore.retry')}
            style={styles.link}
            onPress={() => {
              setCaptchaFailed(false);
              freshCaptcha();
            }}
          >
            <Text style={styles.linkText}>{t('explore.retry')}</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('feedback.send')}
        accessibilityState={{ disabled: busy || !ready, busy }}
        disabled={busy || !ready}
        style={[styles.primary, (busy || !ready) && styles.dim]}
        onPress={send}
      >
        <Text style={styles.primaryText}>{busy ? t('feedback.sending') : t('feedback.send')}</Text>
      </Pressable>
      {signedOut ? <Turnstile key={captchaKey} action="feedback" onToken={onToken} onError={onCaptchaError} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  types: { flexDirection: 'row', gap: 8 },
  choice: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  choiceOn: { backgroundColor: '#1a56db' },
  choiceText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  choiceOnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16, minHeight: 140, textAlignVertical: 'top' },
  hint: { fontSize: 12, color: '#555', textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  withIcon: { flexDirection: 'row', gap: 8 },
  outline: { minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
  ok: { color: '#15803d', fontSize: 16 },
  error: { color: '#b91c1c' },
  dim: { opacity: 0.5 },
});
