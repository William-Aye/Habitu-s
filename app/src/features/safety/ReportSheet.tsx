import { Flag } from 'lucide-react-native';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRequireAccount } from '../account/AccountGate';
import { reportTarget } from './reports';
import { MAX_DETAILS, reasonsFor, type ReportReason, type ReportTarget } from './types';

interface Props {
  target: ReportTarget;
  visible: boolean;
  onClose: () => void;
}

type Outcome = 'sent' | 'limit' | 'error' | null;

/**
 * Pick a reason, add details if wanted, send. The reasons shown depend on what is reported.
 * State lives as long as the component: mount it per opening (useReportSheet does).
 */
export function ReportSheet({ target, visible, onClose }: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const requireAccount = useRequireAccount();
  // Set synchronously: two presses in the same tick must send one report.
  const sending = useRef(false);

  const send = async () => {
    if (sending.current || !reason) return;
    sending.current = true;
    setBusy(true);
    setOutcome(null);
    const r = await reportTarget(target.type, target.id, reason, details.trim() || undefined);
    sending.current = false;
    setBusy(false);
    if (r.ok) return setOutcome('sent');
    if (r.error === 'not_allowed') {
      // The target is gone or no longer visible: say so and leave.
      Alert.alert(t('safety.gone'));
      return onClose();
    }
    if (r.error === 'signed_out') {
      onClose();
      void requireAccount('join');
      return;
    }
    setOutcome(r.error === 'limit_reached' ? 'limit' : 'error');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessible={false} style={styles.backdrop} onPress={onClose}>
        <View accessibilityViewIsModal style={styles.sheet} onStartShouldSetResponder={() => true}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={styles.titleRow}>
              <Flag size={18} color="#111" />
              <Text accessibilityRole="header" style={styles.title}>{t('safety.report')}</Text>
            </View>
            {outcome === 'sent' ? (
              <Text accessibilityLiveRegion="polite" style={styles.ok}>{t('safety.sent')}</Text>
            ) : (
              <>
                <View accessibilityRole="radiogroup" style={styles.group}>
                  {reasonsFor(target.type).map((r) => {
                    const label = t(`safety.reasons.${r}`);
                    const selected = reason === r;
                    return (
                      <Pressable
                        key={r}
                        accessibilityRole="radio"
                        accessibilityLabel={label}
                        accessibilityState={{ selected, disabled: busy }}
                        disabled={busy}
                        style={[styles.choice, selected && styles.choiceOn]}
                        onPress={() => setReason(r)}
                      >
                        <Text style={selected ? styles.choiceOnText : styles.choiceText}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  accessibilityLabel={t('safety.details')}
                  placeholder={t('safety.details')}
                  multiline
                  maxLength={MAX_DETAILS}
                  value={details}
                  editable={!busy}
                  onChangeText={setDetails}
                  style={styles.input}
                />
                {outcome ? (
                  <Text accessibilityLiveRegion="polite" style={styles.error}>
                    {t(outcome === 'limit' ? 'safety.limit' : 'safety.error')}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('safety.send')}
                  accessibilityState={{ disabled: busy || !reason, busy }}
                  disabled={busy || !reason}
                  style={[styles.primary, (busy || !reason) && styles.dim]}
                  onPress={send}
                >
                  <Text style={styles.primaryText}>{t('safety.send')}</Text>
                </Pressable>
              </>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(outcome === 'sent' ? 'safety.close' : 'safety.cancel')}
              style={styles.link}
              onPress={onClose}
            >
              <Text style={styles.linkText}>{t(outcome === 'sent' ? 'safety.close' : 'safety.cancel')}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * Opens the report sheet for something. Signed-out visitors are asked for an account first
 * (reason `join`); the sheet only opens once there is one.
 */
export function useReportSheet(): { openReport: (target: ReportTarget) => Promise<void>; reportSheet: ReactNode } {
  const requireAccount = useRequireAccount();
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const openReport = async (next: ReportTarget) => {
    if (await requireAccount('join')) setTarget(next);
  };
  const reportSheet = target ? <ReportSheet target={target} visible onClose={() => setTarget(null)} /> : null;
  return { openReport, reportSheet };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '90%' },
  content: { padding: 16, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, fontWeight: '700' },
  group: { gap: 8 },
  choice: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#1a56db', justifyContent: 'center', paddingHorizontal: 12 },
  choiceOn: { backgroundColor: '#1a56db' },
  choiceText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  choiceOnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16, minHeight: 88, textAlignVertical: 'top' },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
  ok: { color: '#15803d', fontSize: 16 },
  error: { color: '#b91c1c' },
  dim: { opacity: 0.5 },
});
