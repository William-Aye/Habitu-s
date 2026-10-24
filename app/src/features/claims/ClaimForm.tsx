import * as DocumentPicker from 'expo-document-picker';
import { Paperclip, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRequireAccount } from '../account/AccountGate';
import { MAX_CLAIM_DOCUMENT_BYTES } from '../safety/storageError';
import { CLAIM_DOCUMENT_TYPES, CLAIM_ROLE_MAX, documentMimeType, submitClaim, type ClaimError } from './api';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Doc = { uri: string; name: string; mimeType: string };

/**
 * "C'est mon association": the claimant's role and one proof, an e-mail address or a document. Signing in
 * comes first (reason `join`); `onClose` is called when that is declined or when the form is dismissed.
 */
export function ClaimForm({
  associationId,
  onClose,
  onSent,
}: {
  associationId: string;
  onClose: () => void;
  /** Called once the claim is filed. */
  onSent?: () => void;
}) {
  const { t } = useTranslation();
  const requireAccount = useRequireAccount();
  const [allowed, setAllowed] = useState(false);
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [doc, setDoc] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'sent' | Exclude<ClaimError, 'signed_out'> | null>(null);
  const sending = useRef(false);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void requireAccount('join').then((ok) => (ok ? setAllowed(true) : onClose()));
  }, [requireAccount, onClose]);

  if (!allowed) return null;

  const trimmedEmail = email.trim();
  const emailOk = EMAIL_RE.test(trimmedEmail);
  // An e-mail typed but malformed blocks sending: it would be refused by the database anyway.
  const proofOk = trimmedEmail ? emailOk : doc !== null;
  const ready = role.trim().length >= 2 && proofOk;

  const pick = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: CLAIM_DOCUMENT_TYPES, copyToCacheDirectory: true });
      const a = r.canceled ? null : r.assets?.[0];
      if (!a) return;
      const mimeType = documentMimeType(a.name, a.mimeType);
      if (!mimeType || !CLAIM_DOCUMENT_TYPES.includes(mimeType)) return setOutcome('unsupported');
      if (a.size !== undefined && a.size > MAX_CLAIM_DOCUMENT_BYTES) return setOutcome('too_large');
      setOutcome(null);
      setDoc({ uri: a.uri, name: a.name, mimeType });
    } catch {
      // Picking is optional: nothing to report when the picker cannot be opened.
    }
  };

  const send = async () => {
    if (sending.current || !ready) return;
    sending.current = true;
    setBusy(true);
    setOutcome(null);
    const r = await submitClaim({
      associationId,
      role,
      contactEmail: trimmedEmail || undefined,
      documentUri: doc?.uri,
      documentMimeType: doc?.mimeType,
    });
    sending.current = false;
    setBusy(false);
    if (r.ok) {
      setOutcome('sent');
      onSent?.();
      return;
    }
    if (r.error === 'signed_out') {
      void requireAccount('join');
      return;
    }
    setOutcome(r.error);
  };

  if (outcome === 'sent') {
    return (
      <View style={styles.box}>
        <Text accessibilityLiveRegion="polite" style={styles.ok}>{t('claim.sent')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('claim.close')} style={styles.link} onPress={onClose}>
          <Text style={styles.linkText}>{t('claim.close')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text accessibilityRole="header" style={styles.title}>{t('claim.title')}</Text>
      <TextInput
        accessibilityLabel={t('claim.role')}
        placeholder={t('claim.role')}
        maxLength={CLAIM_ROLE_MAX}
        value={role}
        editable={!busy}
        onChangeText={setRole}
        style={styles.input}
      />
      <TextInput
        accessibilityLabel={t('claim.email')}
        accessibilityHint={t('claim.emailHint')}
        placeholder={t('claim.email')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={254}
        value={email}
        editable={!busy}
        onChangeText={setEmail}
        style={styles.input}
      />
      {doc ? (
        <View style={styles.row}>
          <Text style={styles.flex}>{t('claim.attached', { name: doc.name })}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('claim.removeDocument')}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={styles.iconButton}
            onPress={() => setDoc(null)}
          >
            <X size={20} color="#1a56db" />
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('claim.attach')}
          accessibilityHint={t('claim.attachHint')}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          style={[styles.outline, styles.withIcon]}
          onPress={pick}
        >
          <Paperclip size={18} color="#1a56db" />
          <Text style={styles.outlineText}>{t('claim.attach')}</Text>
        </Pressable>
      )}
      {outcome ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>{t(`claim.errors.${outcome}`)}</Text>
      ) : null}
      <Text style={styles.notice}>{t('claim.notice')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('claim.send')}
        accessibilityState={{ disabled: busy || !ready, busy }}
        disabled={busy || !ready}
        style={[styles.primary, (busy || !ready) && styles.dim]}
        onPress={send}
      >
        <Text style={styles.primaryText}>{busy ? t('claim.sending') : t('claim.send')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('claim.cancel')}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        style={styles.link}
        onPress={onClose}
      >
        <Text style={styles.linkText}>{t('claim.cancel')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12, borderWidth: 1, borderColor: '#ccc', borderRadius: 12, padding: 12 },
  title: { fontSize: 18, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16, minHeight: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  withIcon: { flexDirection: 'row', gap: 8 },
  outline: { minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
  ok: { color: '#15803d', fontSize: 16 },
  notice: { fontSize: 12, color: '#555' },
  error: { color: '#b91c1c' },
  dim: { opacity: 0.5 },
});
