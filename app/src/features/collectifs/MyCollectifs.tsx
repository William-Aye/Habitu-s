import { useFocusEffect, useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MyCollectif } from '../activities/types';
import { CreateCollectifForm } from './CreateCollectifForm';
import { myCollectifs } from './api';

/** Profil section: the collectifs I organise, and a way to create one. */
export function MyCollectifs() {
  const { t } = useTranslation();
  const router = useRouter();
  const [items, setItems] = useState<MyCollectif[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  // Re-read each time Profil is shown again: a delete, leave or answered invitation changes the list.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      myCollectifs().then((r) => {
        if (!active) return;
        if (r.ok) {
          setItems(r.collectifs);
          setFailed(false);
        } else {
          setFailed(true);
        }
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const open = (id: string) => router.push({ pathname: '/collectifs/[id]', params: { id } });

  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('profile.collectifs.title')}
      </Text>
      {failed ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {t('profile.collectifs.error')}
        </Text>
      ) : null}
      {items && items.length === 0 ? <Text>{t('profile.collectifs.none')}</Text> : null}
      {(items ?? []).map((c) => (
        <Pressable
          key={c.id}
          accessibilityRole="link"
          accessibilityLabel={t('profile.collectifs.open', { name: c.name })}
          style={styles.row}
          onPress={() => open(c.id)}
        >
          <Text style={styles.linkText}>{c.name}</Text>
          <Text style={styles.hint}>{`${c.townLabel} · ${t(`collectif.role.${c.role}`)}`}</Text>
        </Pressable>
      ))}
      {creating ? (
        <CreateCollectifForm
          onCancel={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            setItems((cur) => [...(cur ?? []), c]);
            open(c.id);
          }}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.collectifs.create')}
          style={styles.outline}
          onPress={() => setCreating(true)}
        >
          <Plus size={18} color="#1a56db" />
          <Text style={styles.outlineText}>{t('profile.collectifs.create')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  heading: { fontSize: 18, fontWeight: '600' },
  row: { minHeight: 48, justifyContent: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
  hint: { fontSize: 13, color: '#555' },
  error: { color: '#b91c1c' },
  outline: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1a56db',
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
});
