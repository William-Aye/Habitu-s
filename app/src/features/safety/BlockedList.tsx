import { UserRoundCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { listBlocked, unblock, type BlockedPerson } from './blocks';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; people: BlockedPerson[] };

export function BlockedList() {
  const { t } = useTranslation();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Bumping the version reads the list again (retry).
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    listBlocked().then((r) => {
      if (active) setLoad(r.ok ? { state: 'ready', people: r.blocked } : { state: 'error' });
    });
    return () => {
      active = false;
    };
  }, [version]);

  const remove = async (p: BlockedPerson) => {
    if (busyId) return;
    setBusyId(p.userId);
    setFailed(false);
    const r = await unblock(p.userId);
    setBusyId(null);
    if (!r.ok) return setFailed(true);
    setLoad((cur) =>
      cur.state === 'ready' ? { state: 'ready', people: cur.people.filter((x) => x.userId !== p.userId) } : cur,
    );
  };

  if (load.state === 'loading') {
    return <ActivityIndicator style={styles.center} accessibilityLabel={t('safety.blockedLoading')} />;
  }
  if (load.state === 'error') {
    return (
      <View style={styles.center}>
        <Text>{t('safety.blockedError')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('safety.retry')}
          style={styles.link}
          onPress={() => {
            setLoad({ state: 'loading' });
            setVersion((v) => v + 1);
          }}
        >
          <Text style={styles.linkText}>{t('safety.retry')}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.container}>
      {failed ? <Text accessibilityLiveRegion="polite" style={styles.error}>{t('safety.error')}</Text> : null}
      {load.people.length === 0 ? <Text>{t('safety.blockedEmpty')}</Text> : null}
      {load.people.map((p) => (
        <View key={p.userId} style={styles.row}>
          <Text style={styles.name}>{p.firstName}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('safety.unblockAria', { prenom: p.firstName })}
            accessibilityState={{ disabled: !!busyId, busy: busyId === p.userId }}
            disabled={!!busyId}
            style={[styles.outline, !!busyId && styles.dim]}
            onPress={() => remove(p)}
          >
            <UserRoundCheck size={18} color="#1a56db" />
            <Text style={styles.outlineText}>{t('safety.unblock')}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { marginTop: 80, padding: 16, alignItems: 'center', gap: 12 },
  container: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 48 },
  name: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  outline: { flexDirection: 'row', gap: 6, minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: '#1a56db', paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
  error: { color: '#b91c1c' },
  dim: { opacity: 0.5 },
});
