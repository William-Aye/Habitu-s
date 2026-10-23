import { router, useFocusEffect } from 'expo-router';
import { BellOff, Compass, MessageCircle } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../features/account/useSession';
import { myChats } from '../../features/chat/api';
import { formatMessageTime } from '../../features/chat/formatTime';
import type { ChatSummary } from '../../features/chat/types';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; chats: ChatSummary[] };

export default function Messages() {
  const { t } = useTranslation();
  const { status } = useSession();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshFailed, setRefreshFailed] = useState(false);

  const requestId = useRef(0);
  const refresh = useCallback(() => {
    if (status === 'loading') return;
    if (status !== 'ready') {
      setLoad({ state: 'ready', chats: [] });
      return;
    }
    const id = ++requestId.current;
    myChats().then((r) => {
      if (id !== requestId.current) return; // a newer read or a blur superseded this one
      if (r.ok) {
        setLoad({ state: 'ready', chats: r.chats });
        setRefreshFailed(false);
      } else if (r.error === 'signed_out') {
        setLoad({ state: 'ready', chats: [] });
      } else {
        // Keep a list that is already on screen.
        setLoad((cur) => (cur.state === 'ready' ? cur : { state: 'error' }));
        setRefreshFailed(true);
      }
    });
  }, [status]);

  // Re-read each time the tab is shown again: new messages and reads happen elsewhere.
  useFocusEffect(
    useCallback(() => {
      refresh();
      return () => {
        requestId.current++;
      };
    }, [refresh]),
  );

  if (load.state === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator accessibilityLabel={t('messages.loading')} />
      </View>
    );
  }

  if (load.state === 'error') {
    return (
      <View style={styles.center}>
        <Text accessibilityLiveRegion="polite">{t('messages.error')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('messages.retry')}
          style={styles.outline}
          onPress={() => {
            setLoad({ state: 'loading' });
            refresh();
          }}
        >
          <Text style={styles.outlineText}>{t('messages.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (load.chats.length === 0) {
    return (
      <View style={styles.center}>
        <MessageCircle size={32} color="#6b7280" />
        <Text accessibilityRole="header" style={styles.title}>{t('messages.empty')}</Text>
        <Text style={styles.hint}>{t('messages.emptyHint')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('messages.explore')}
          style={styles.primary}
          onPress={() => router.replace('/')}
        >
          <Compass size={18} color="#fff" />
          <Text style={styles.primaryText}>{t('messages.explore')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text accessibilityRole="header" style={styles.title}>{t('messages.title')}</Text>
      {refreshFailed ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>{t('messages.error')}</Text>
      ) : null}
      {load.chats.map((c) => {
        const last = c.lastMessage;
        const preview = !last
          ? t('messages.noMessage')
          : last.isMine
            ? t('messages.previewMine', { texte: last.body })
            : last.senderFirstName
              ? t('messages.previewOther', { prenom: last.senderFirstName, texte: last.body })
              : last.body;
        return (
          <Pressable
            key={c.activityId}
            testID={`chat-row-${c.activityId}`}
            accessibilityRole="button"
            accessibilityLabel={
              c.unreadCount > 0
                ? `${t('messages.open', { title: c.title })}, ${t('messages.unread', { count: c.unreadCount })}`
                : t('messages.open', { title: c.title })
            }
            style={styles.row}
            onPress={() => router.push(`/discussions/${c.activityId}` as never)}
          >
            <View style={styles.body}>
              <View style={styles.line}>
                <Text testID="chat-title" numberOfLines={1} style={[styles.rowTitle, c.unreadCount > 0 && styles.bold]}>
                  {c.title}
                </Text>
                {last ? <Text style={styles.time}>{formatMessageTime(last.createdAt, new Date(), t('messages.yesterday'))}</Text> : null}
              </View>
              <Text numberOfLines={1} style={styles.preview}>{preview}</Text>
              {c.muted ? (
                <View style={styles.line}>
                  <BellOff size={14} color="#6b7280" />
                  <Text style={styles.mutedText}>{t('messages.muted')}</Text>
                </View>
              ) : null}
            </View>
            {c.unreadCount > 0 ? (
              <View style={[styles.badge, c.muted && styles.badgeMuted]}>
                <Text style={styles.badgeText}>{c.unreadCount > 99 ? '99+' : String(c.unreadCount)}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  hint: { textAlign: 'center', color: '#4b5563' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12 },
  body: { flex: 1, gap: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: '600' },
  bold: { fontWeight: '800' },
  time: { color: '#6b7280', fontSize: 12 },
  preview: { color: '#4b5563' },
  mutedText: { color: '#6b7280', fontSize: 12 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  badgeMuted: { backgroundColor: '#6b7280' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  outline: { minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#1a56db', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  error: { color: '#b91c1c' },
});
