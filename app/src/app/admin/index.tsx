import { router, useFocusEffect } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { listCategoryRequests, listClaims, listClubs, listFeedback, listReports, type AdminResult } from '../../features/admin/api';
import { BannedWords } from '../../features/admin/BannedWords';
import { useAdminLock } from '../../features/admin/MfaGate';
import { AdminScreen } from '../../features/admin/ui';

const QUEUES = ['reports', 'claims', 'clubs', 'categories', 'feedback'] as const;
type QueueName = (typeof QUEUES)[number];

/** The server pages these lists at 50: a full page means there may be more. */
const LIST_CAP = 50;

const counters: Record<QueueName, () => Promise<AdminResult<{ count: number; capped: boolean }>>> = {
  reports: async () => {
    const r = await listReports();
    return r.ok ? { ok: true, count: r.openCount, capped: false } : r;
  },
  claims: async () => {
    const r = await listClaims();
    return r.ok ? { ok: true, count: r.items.length, capped: r.items.length >= LIST_CAP } : r;
  },
  clubs: async () => {
    const r = await listClubs();
    return r.ok ? { ok: true, count: r.items.length, capped: r.items.length >= LIST_CAP } : r;
  },
  categories: async () => {
    const r = await listCategoryRequests();
    return r.ok ? { ok: true, count: r.items.length, capped: r.items.length >= LIST_CAP } : r;
  },
  feedback: async () => {
    const r = await listFeedback();
    return r.ok ? { ok: true, count: r.items.length, capped: r.items.length >= LIST_CAP } : r;
  },
};

export default function AdminHome() {
  const { t } = useTranslation();
  const lock = useAdminLock();
  const [counts, setCounts] = useState<Partial<Record<QueueName, string>>>({});

  // Counts are read again each time the screen regains focus, after working in a queue.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      for (const name of QUEUES) {
        void counters[name]().then((r) => {
          if (!active) return;
          if (r.ok) setCounts((c) => ({ ...c, [name]: r.capped ? `${r.count}+` : String(r.count) }));
          else if (r.error === 'not_allowed') void lock();
        });
      }
      return () => {
        active = false;
      };
    }, [lock]),
  );

  return (
    <AdminScreen title={t('admin.title')}>
      {QUEUES.map((name) => {
        const count = counts[name];
        const label = t(`admin.queues.${name}`);
        return (
          <Pressable
            key={name}
            accessibilityRole="button"
            accessibilityLabel={count === undefined ? label : t('admin.queueAria', { nom: label, nombre: count })}
            style={styles.row}
            onPress={() => router.push({ pathname: '/admin/[queue]', params: { queue: name } })}
          >
            <Text style={styles.label}>{label}</Text>
            <View style={styles.right}>
              <Text style={styles.count}>{count ?? ''}</Text>
              <ChevronRight size={20} color="#4b5563" />
            </View>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('admin.liftBan.title')}
        style={styles.row}
        onPress={() => router.push('/admin/lift-ban')}
      >
        <Text style={styles.label}>{t('admin.liftBan.title')}</Text>
        <ChevronRight size={20} color="#4b5563" />
      </Pressable>
      <BannedWords />
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#d1d5db' },
  label: { fontSize: 17, fontWeight: '600' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  count: { fontSize: 16, color: '#1a56db', fontWeight: '700' },
});
