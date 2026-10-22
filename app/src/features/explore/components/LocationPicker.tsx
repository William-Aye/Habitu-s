import { MapPin } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { searchTowns } from '../api';
import type { Town } from '../types';

export function LocationPicker({
  onGps,
  onTown,
}: {
  onGps(): Promise<'ok' | 'denied'>;
  onTown(town: Town): void;
}) {
  const { t } = useTranslation();
  const [typing, setTyping] = useState(false);
  const [q, setQ] = useState('');
  const [towns, setTowns] = useState<Town[]>([]);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchTowns(query)
        .then((r) => !cancelled && setTowns(r))
        .catch(() => !cancelled && setTowns([]));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  return (
    <View style={styles.box}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('explore.location.useGps')}
        style={styles.button}
        onPress={async () => setDenied((await onGps()) === 'denied')}
      >
        <MapPin size={18} color="#fff" />
        <Text style={styles.buttonText}>{t('explore.location.useGps')}</Text>
      </Pressable>
      {denied ? <Text style={styles.note}>{t('explore.location.denied')}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('explore.location.enterTown')}
        style={[styles.button, styles.secondary]}
        onPress={() => setTyping(true)}
      >
        <Text style={styles.secondaryText}>{t('explore.location.enterTown')}</Text>
      </Pressable>
      {typing ? (
        <View>
          <TextInput
            style={styles.input}
            value={q}
            onChangeText={setQ}
            autoFocus
            placeholder={t('explore.location.townPlaceholder')}
            accessibilityLabel={t('explore.location.townPlaceholder')}
          />
          {(q.trim().length >= 2 ? towns : []).map((town) => (
            <Pressable
              key={`${town.label}:${town.lon}:${town.lat}`}
              accessibilityRole="button"
              accessibilityLabel={town.label}
              style={styles.town}
              onPress={() => onTown(town)}
            >
              <Text>{town.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12, paddingVertical: 16 },
  button: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: '#1a56db',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#1a56db' },
  secondaryText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  note: { fontSize: 13, color: '#a00' },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 24,
    paddingHorizontal: 16,
  },
  town: { minHeight: 48, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#eee' },
});
