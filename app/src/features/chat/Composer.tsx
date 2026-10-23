import { SendHorizontal } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MAX = 2000;
const SHOW_COUNT_FROM = 1800;

/** `onSend` returns false when the message was refused (empty, too long): the text is then kept. */
export function Composer({ onSend }: { onSend: (body: string) => boolean }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const empty = text.trim().length === 0;

  const submit = () => {
    if (empty) return;
    if (onSend(text)) setText('');
  };

  return (
    <View testID="composer" style={[styles.wrap, { paddingBottom: 8 + insets.bottom }]}>
      {text.length >= SHOW_COUNT_FROM ? (
        <Text accessibilityLiveRegion="polite" style={styles.count}>
          {t('chat.count', { count: text.length })}
        </Text>
      ) : null}
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          multiline
          maxLength={MAX}
          value={text}
          onChangeText={setText}
          placeholder={t('chat.placeholder')}
          accessibilityLabel={t('chat.placeholder')}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.send')}
          accessibilityState={{ disabled: empty }}
          disabled={empty}
          style={[styles.send, empty && styles.dim]}
          onPress={submit}
        >
          <SendHorizontal size={18} color="#fff" />
          <Text style={styles.sendText}>{t('chat.send')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb', backgroundColor: '#fff', gap: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  send: { flexDirection: 'row', gap: 6, minHeight: 44, borderRadius: 22, paddingHorizontal: 14, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontWeight: '600' },
  count: { alignSelf: 'flex-end', fontSize: 12, color: '#6b7280' },
  dim: { opacity: 0.5 },
});
