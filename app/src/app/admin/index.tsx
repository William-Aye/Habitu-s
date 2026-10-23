import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { listCategoryRequests, listClaims, listClubs, listFeedback, listReports, type AdminResult } from '../../features/admin/api';
import { BannedWords } from '../../features/admin/BannedWords';
import { useAdminLock } from '../../features/admin/MfaGate';
import { AdminScreen } from '../../features/admin/ui';

const QUEUES = ['reports', 'claims', 'clubs', 'categories', 'feedback'] as const;
type QueueName = (typeof QUEUES)[number];

const counters: Record<QueueName, () => Promise<AdminResult<{ count: number }>>> = {
  reports: async () => {
    const r = await listReports();
    return r.ok ? { ok: true, count: r.openCount } : r;
  },
  claims: async () => {
    const r = await listClaims();
    return r.ok ? { ok: true, count: r.items.length } : r;
  },
  clubs: async () => {
    const r = await listClubs();
    return r.ok ? { ok: true, count: r.items.length } : r;
  },
  categories: async () => {
    const r = await listCategoryRequests();
    return r.ok ? { ok: true, count: r.items.length } : r;
  },
  feedback: async () => {
    const r = await listFeedback();
    return r.ok ? { ok: true, count: r.items.length } : r;
  },
};

export default function AdminHome() {
  const { t } = useTranslation();
  const lock = useAdminLock();
  const [counts, setCounts] = useState<Partial<Record<QueueName, number>>>({});

  useEffect(() => {
    let active = true;
    for (const name of QUEUES) {
      void counters[name]().then((r) => {
        if (!active) return;
        if (r.ok) setCounts((c) => ({ ...c, [name]: r.count }));
        else if (r.error === 'not_allowed') lock();
      });
    }
    return () => {
      active = false;
    };
  }, [lock]);

  return (
    <AdminScreen title={t('admin.title')}>
      {QUEUES.map((name) => {
        const count = counts[name];
        const label = t(`admin.queues.${name}`);
        return (
          <Pressable
            key={name}
            accessibilityRole="button"
            accessibilityLabel={count === undefined ? label : t('admin.queueAria', { nom: label, count })}
            style={styles.row}
            onPress={() => router.push({ pathname: '/admin/[queue]', params: { queue: name } })}
          >
            <Text style={styles.label}>{label}</Text>
            <View style={styles.right}>
              <Text style={styles.count}>{count === undefined ? '' : String(count)}</Text>
              <ChevronRight size={20} color="#4b5563" />
            </View>
          </Pressable>
        );
      })}
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
