import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ReportReason } from './types';
import type { DisplayMessage } from './useChat';

const REASONS: ReportReason[] = ['inappropriate', 'harassment', 'scam', 'other'];

interface Props {
  target: DisplayMessage | null;
  busy: boolean;
  onClose: () => void;
  onDelete: (m: DisplayMessage) => void;
  onDiscard: (m: DisplayMessage) => void;
  onReport: (m: DisplayMessage, reason: ReportReason) => void;
  onBlock: (m: DisplayMessage) => void;
}

/** The long-press sheet: delete on my own message, report or block on someone else's. */
export function MessageActions({ target, busy, onClose, onDelete, onDiscard, onReport, onBlock }: Props) {
  const { t } = useTranslation();
  // The reason picker belongs to one message: opening another starts at the menu again.
  const [reasonsFor, setReasonsFor] = useState<string | null>(null);
  const reasons = !!target && reasonsFor === target.id;

  const item = (label: string, onPress: () => void, destructive = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      style={[styles.item, busy && styles.dim]}
      onPress={onPress}
    >
      <Text style={destructive ? styles.destructive : styles.itemText}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessible={false} style={styles.backdrop} onPress={onClose}>
        <View accessibilityViewIsModal style={styles.sheet}>
          {target ? (
            reasons ? (
              <>
                <Text accessibilityRole="header" style={styles.title}>{t('chat.actions.reportTitle')}</Text>
                {REASONS.map((r) => item(t(`chat.reasons.${r}`), () => onReport(target, r)))}
              </>
            ) : target.pending ? (
              item(t('chat.actions.discard'), () => onDiscard(target), true)
            ) : target.isMine ? (
              item(t('chat.actions.delete'), () => onDelete(target), true)
            ) : (
              <>
                {item(t('chat.actions.report'), () => setReasonsFor(target.id))}
                {item(t('chat.actions.block', { prenom: target.sender.firstName }), () => onBlock(target), true)}
              </>
            )
          ) : null}
          {item(t('chat.actions.cancel'), onClose)}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 12, gap: 4 },
  title: { fontSize: 16, fontWeight: '700', padding: 8 },
  item: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  itemText: { fontSize: 16, color: '#1a56db', fontWeight: '600' },
  destructive: { fontSize: 16, color: '#b91c1c', fontWeight: '600' },
  dim: { opacity: 0.5 },
});
