import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AdminError, AdminResult } from './api';
import { AdminButton } from './buttons';
import { useAdminLock } from './MfaGate';

export { AdminButton };

export function AdminScreen({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('admin.back')}
          style={styles.iconButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        >
          <ChevronLeft size={24} color="#1a56db" />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

export function ErrorText({ code }: { code: AdminError | null }) {
  const { t } = useTranslation();
  return code ? (
    <Text accessibilityLiveRegion="polite" style={styles.error}>{t(`admin.errors.${code}`)}</Text>
  ) : null;
}

type Load<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; items: T[] };

/**
 * What to do with a failed admin call: not_allowed first checks the second factor (back to the code screen
 * if it is missing), and is otherwise a refusal about the item.
 */
export function useFailure(setError: (e: AdminError | null) => void) {
  const lock = useAdminLock();
  return useCallback(
    async (error: AdminError) => {
      if (error !== 'not_allowed') return setError(error);
      if (!(await lock())) setError('refused');
    },
    [lock, setError],
  );
}

export function DoneNotice({ show }: { show: boolean }) {
  const { t } = useTranslation();
  return show ? <Text accessibilityLiveRegion="polite" style={styles.done}>{t('admin.done')}</Text> : null;
}

/** Loads a queue and applies decisions one at a time. */
export function useQueue<T extends { id: string }>(loader: () => Promise<AdminResult<{ items: T[] }>>) {
  const lock = useAdminLock();
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' });
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<AdminError | null>(null);
  const [done, setDone] = useState(false);
  const inflight = useRef(false);
  const fail = useFailure(setError);

  useEffect(() => {
    let active = true;
    void loader().then(async (r) => {
      if (!active) return;
      if (r.ok) return setLoad({ state: 'ready', items: r.items });
      if (r.error === 'not_allowed' && (await lock())) return;
      if (active) setLoad({ state: 'error' });
    });
    return () => {
      active = false;
    };
  }, [loader, version, lock]);

  const reload = useCallback(() => {
    setLoad({ state: 'loading' });
    setVersion((v) => v + 1);
  }, []);

  /** Runs one action on an item; true when it succeeded. `after` decides what becomes of the item (default: removed). */
  const act = useCallback(
    async (id: string, fn: () => Promise<AdminResult>, after?: (item: T) => T): Promise<boolean> => {
      if (inflight.current) return false;
      inflight.current = true;
      setBusyId(id);
      setError(null);
      setDone(false);
      try {
        const r = await fn();
        if (r.ok) {
          setDone(true);
          setLoad((cur) =>
            cur.state !== 'ready'
              ? cur
              : {
                  state: 'ready',
                  items: after
                    ? cur.items.map((x) => (x.id === id ? after(x) : x))
                    : cur.items.filter((x) => x.id !== id),
                },
          );
          return true;
        }
        await fail(r.error);
        if (r.error === 'already_decided' || r.error === 'not_found') reload();
        return false;
      } finally {
        inflight.current = false;
        setBusyId(null);
      }
    },
    [fail, reload],
  );

  return { load, busyId, error, setError, done, act, reload, fail };
}

export function QueueState<T>({
  load,
  empty,
  onRetry,
  children,
}: {
  load: Load<T>;
  empty: string;
  onRetry: () => void;
  children: (items: T[]) => ReactNode;
}) {
  const { t } = useTranslation();
  if (load.state === 'loading') return <ActivityIndicator style={styles.center} accessibilityLabel={t('admin.loading')} />;
  if (load.state === 'error') {
    return (
      <View style={styles.center}>
        <Text accessibilityLiveRegion="polite">{t('admin.errors.load')}</Text>
        <AdminButton label={t('admin.retry')} onPress={onRetry} />
      </View>
    );
  }
  if (load.items.length === 0) return <Text style={styles.empty}>{empty}</Text>;
  return <>{children(load.items)}</>;
}

export const adminStyles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12, padding: 12, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  meta: { color: '#4b5563' },
  input: { borderWidth: 1, borderColor: '#9ca3af', borderRadius: 8, padding: 10, minHeight: 44, fontSize: 16 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { fontWeight: '600' },
  choice: { borderWidth: 1, borderColor: '#9ca3af', borderRadius: 18, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  chosen: { backgroundColor: '#dbeafe', borderColor: '#1a56db' },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 4, paddingHorizontal: 4 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', flexShrink: 1 },
  container: { paddingHorizontal: 16, paddingBottom: 48, gap: 12 },
  center: { marginTop: 60, padding: 16, alignItems: 'center', gap: 12 },
  empty: { color: '#4b5563', marginTop: 24 },
  error: { color: '#b91c1c' },
  done: { color: '#166534' },
});
