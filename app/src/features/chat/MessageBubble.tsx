import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PersonAvatar } from '../activities/PersonAvatar';
import { formatMessageTime } from './formatTime';
import type { DisplayMessage } from './useChat';

interface Props {
  message: DisplayMessage;
  onLongPress: (m: DisplayMessage) => void;
  onRetry: (id: string) => void;
}

/** One message. URLs stay plain text on purpose: no auto-link. */
export function MessageBubble({ message: m, onLongPress, onRetry }: Props) {
  const { t } = useTranslation();
  const p = m.pending;
  const needsRetry = !!p && (p.state === 'failed' || p.stalled);
  const time = p ? '' : formatMessageTime(m.createdAt, new Date(), t('messages.yesterday'));
  const label = p
    ? m.body
    : t(m.isMine ? 'chat.bubbleMine' : 'chat.bubbleOther', { name: m.sender.firstName, time, body: m.body });
  const status = !p
    ? null
    : p.state === 'failed' && p.error === 'limit_reached'
      ? t('chat.limit')
      : needsRetry
        ? t('chat.unsent')
        : t('chat.sending');

  return (
    <View style={[styles.row, m.isMine && styles.rowMine]}>
      {m.isMine ? null : <PersonAvatar name={m.sender.firstName} photoUrl={m.sender.photoUrl} size={32} />}
      <Pressable
        accessibilityRole={needsRetry ? 'button' : undefined}
        accessibilityLabel={label}
        accessibilityHint={t('chat.actionsHint')}
        onPress={needsRetry && p ? () => onRetry(p.id) : undefined}
        onLongPress={() => onLongPress(m)}
        style={[styles.bubble, m.isMine ? styles.bubbleMine : styles.bubbleOther]}
      >
        {m.isMine ? null : <Text style={styles.name}>{m.sender.firstName}</Text>}
        <Text style={m.isMine ? styles.bodyMine : styles.body}>{m.body}</Text>
        {status ? (
          <Text style={[styles.meta, needsRetry && styles.metaError]}>{status}</Text>
        ) : (
          <Text style={m.isMine ? styles.metaMine : styles.meta}>{time}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginVertical: 4, paddingHorizontal: 12 },
  rowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  bubbleOther: { backgroundColor: '#f3f4f6' },
  bubbleMine: { backgroundColor: '#1a56db' },
  name: { fontSize: 12, fontWeight: '700', color: '#1a3a9e' },
  body: { fontSize: 16, color: '#111827' },
  bodyMine: { fontSize: 16, color: '#fff' },
  meta: { fontSize: 11, color: '#6b7280', alignSelf: 'flex-end' },
  metaMine: { fontSize: 11, color: '#dbeafe', alignSelf: 'flex-end' },
  metaError: { color: '#b91c1c', fontWeight: '600' },
});
