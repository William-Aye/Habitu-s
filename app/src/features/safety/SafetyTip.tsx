import { Flag, Share2, ShieldAlert } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TIPS, useTipSeen, type TipId } from './tips';

/** The text of a tip, with no behaviour (also used by the Conseils de sécurité page). */
export function TipCard({ id, children }: { id: TipId; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <View style={styles.tip}>
      <View style={styles.head}>
        <ShieldAlert size={20} color="#92400e" />
        <View style={styles.lines}>
          {TIPS[id].map((key) => (
            <Text key={key} style={styles.text}>{t(key)}</Text>
          ))}
        </View>
      </View>
      {children}
    </View>
  );
}

interface Props {
  id: TipId;
  /** Shows a "Signaler cette séance" link under the tip. */
  onReport?: () => void;
  /** Shows a "Partager mon programme" button under the tip. */
  onShare?: () => Promise<unknown> | void;
}

/** A tip shown until the person says "Compris"; then never again. */
export function SafetyTip({ id, onReport, onShare }: Props) {
  const { t } = useTranslation();
  const { seen, dismiss } = useTipSeen(id);
  const [busy, setBusy] = useState(false);
  if (seen) return null;

  const share = async () => {
    if (busy || !onShare) return;
    setBusy(true);
    try {
      await onShare();
    } catch {
      // A closed or unavailable share sheet is not an error worth showing.
    }
    setBusy(false);
  };
  const understood = async () => {
    if (busy) return;
    setBusy(true);
    await dismiss();
    setBusy(false);
  };

  return (
    <TipCard id={id}>
      <View style={styles.actions}>
        {onShare ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('safety.sharePlans')}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={[styles.link, busy && styles.dim]}
            onPress={share}
          >
            <Share2 size={16} color="#1a56db" />
            <Text style={styles.linkText}>{t('safety.sharePlans')}</Text>
          </Pressable>
        ) : null}
        {onReport ? (
          <Pressable accessibilityRole="link" accessibilityLabel={t('safety.reportSession')} style={styles.link} onPress={onReport}>
            <Flag size={16} color="#1a56db" />
            <Text style={styles.linkText}>{t('safety.reportSession')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('safety.understood')}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          style={[styles.link, busy && styles.dim]}
          onPress={understood}
        >
          <Text style={styles.linkText}>{t('safety.understood')}</Text>
        </Pressable>
      </View>
    </TipCard>
  );
}

const styles = StyleSheet.create({
  tip: { gap: 8, backgroundColor: '#fffbeb', borderRadius: 12, padding: 12 },
  head: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  lines: { flex: 1, gap: 4 },
  text: { fontSize: 14, color: '#92400e' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  linkText: { color: '#1a56db', fontWeight: '600' },
  dim: { opacity: 0.5 },
});
