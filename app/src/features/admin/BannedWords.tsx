import { X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { listBannedWords, setBannedWord, type AdminError } from './api';
import { adminStyles as s, AdminButton, ErrorText, useFailure } from './ui';
import { useAdminLock } from './MfaGate';

export function BannedWords() {
  const { t } = useTranslation();
  const lock = useAdminLock();
  const [words, setWords] = useState<string[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminError | null>(null);
  const inflight = useRef(false);
  const fail = useFailure(setError);

  useEffect(() => {
    let active = true;
    void listBannedWords().then((r) => {
      if (!active) return;
      if (r.ok) return setWords(r.words);
      setWords([]);
      if (r.error === 'not_allowed') return void lock();
      setError(r.error);
    });
    return () => {
      active = false;
    };
  }, [lock]);

  const change = async (word: string, add: boolean) => {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError(null);
    const r = await setBannedWord(word, add);
    inflight.current = false;
    setBusy(false);
    if (!r.ok) return fail(r.error);
    const folded = word.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    setWords((cur) => {
      const list = (cur ?? []).filter((w) => w !== folded);
      return add ? [...list, folded].sort() : list;
    });
    if (add) setText('');
  };

  return (
    <View style={s.card}>
      <Text accessibilityRole="header" style={s.cardTitle}>{t('admin.bannedWords.title')}</Text>
      <ErrorText code={error} />
      <View style={styles.add}>
        <TextInput
          accessibilityLabel={t('admin.bannedWords.add')}
          placeholder={t('admin.bannedWords.add')}
          style={[s.input, styles.grow]}
          maxLength={50}
          autoCapitalize="none"
          value={text}
          editable={!busy}
          onChangeText={setText}
        />
        <AdminButton
          label={t('admin.bannedWords.addAction')}
          busy={busy}
          disabled={text.trim().length < 3}
          onPress={() => void change(text, true)}
        />
      </View>
      {words && words.length === 0 ? <Text style={s.meta}>{t('admin.bannedWords.empty')}</Text> : null}
      <View style={s.row}>
        {(words ?? []).map((w) => (
          <Pressable
            key={w}
            accessibilityRole="button"
            accessibilityLabel={t('admin.bannedWords.remove', { mot: w })}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={[s.choice, styles.chip, busy && styles.dim]}
            onPress={() => void change(w, false)}
          >
            <Text>{w}</Text>
            <X size={16} color="#4b5563" />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  add: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  grow: { flex: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dim: { opacity: 0.5 },
});
