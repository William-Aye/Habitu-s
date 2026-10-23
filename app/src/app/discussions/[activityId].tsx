import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Bell, BellOff, ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireAccount } from '../../features/account/AccountGate';
import { useSession } from '../../features/account/useSession';
import { Composer } from '../../features/chat/Composer';
import { MessageActions } from '../../features/chat/MessageActions';
import { MessageBubble } from '../../features/chat/MessageBubble';
import { useChat, type DisplayMessage } from '../../features/chat/useChat';
import { block } from '../../features/safety/blocks';
import { confirmBlock } from '../../features/safety/confirmBlock';
import { useReportSheet } from '../../features/safety/ReportSheet';

export default function DiscussionScreen() {
  const { t } = useTranslation();
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  const { status, userId } = useSession();
  const requireAccount = useRequireAccount();
  const insets = useSafeAreaInsets();

  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const chat = useChat(activityId, focused);

  // Signed out (at open, or when a read says the session is gone): the account gate, once per mount.
  // Backing out of it leaves the screen, signing in reads the discussion again; if it is still signed out
  // after that, the error screen takes over instead of asking again.
  const signedOut = status === 'signed_out' || status === 'needs_profile' || chat.needsAccount;
  const asked = useRef(false);
  const [gateDone, setGateDone] = useState(false);
  const { retryLoad } = chat;
  useEffect(() => {
    if (!signedOut || asked.current) return;
    asked.current = true;
    void requireAccount('message').then((ok) => {
      setGateDone(true);
      if (!ok) router.back();
      else retryLoad();
    });
  }, [signedOut, requireAccount, retryLoad]);
  const [target, setTarget] = useState<DisplayMessage | null>(null);
  const { openReport, reportSheet } = useReportSheet();
  const [notice, setNotice] = useState<string | null>(null);

  // The list is inverted: newest first.
  const data = useMemo(() => [...chat.messages].reverse(), [chat.messages]);

  const confirmDelete = (m: DisplayMessage) => {
    setTarget(null);
    Alert.alert(t('chat.actions.deleteConfirm'), undefined, [
      { text: t('chat.actions.cancel'), style: 'cancel' },
      {
        text: t('chat.actions.delete'),
        style: 'destructive',
        onPress: async () => {
          const r = await chat.remove(m.id);
          setNotice(r.ok ? null : t('chat.actions.error'));
        },
      },
    ]);
  };

  const blockSender = (m: DisplayMessage) => {
    setTarget(null);
    // Blocking also ends the membership when the organiser is one of the two people.
    const blocksOrganiser = !!chat.organiserId && m.sender.id === chat.organiserId;
    const iAmOrganiser = !!chat.organiserId && userId === chat.organiserId;
    const effect = blocksOrganiser ? 'leaves_activity' : iAmOrganiser ? 'removes_member' : 'plain';
    confirmBlock(t, m.sender.firstName, effect, async () => {
      const r = await block(m.sender.id);
      if (r.ok && blocksOrganiser) {
        // The membership is gone: leave rather than show the join prompt.
        router.back();
      } else if (r.ok) {
        setNotice(null);
        await chat.reload();
      } else {
        setNotice(t('chat.actions.error'));
      }
    });
  };

  const report = (m: DisplayMessage) => {
    setTarget(null);
    void openReport({ type: 'message', id: m.id });
  };

  if (chat.state === 'error' || (signedOut && gateDone)) {
    return (
      <View style={styles.center}>
        <Text>{t('chat.loadError')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.retry')}
          style={styles.link}
          onPress={chat.retryLoad}
        >
          <Text style={styles.linkText}>{t('chat.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (status !== 'ready' || chat.state === 'loading') {
    return <ActivityIndicator style={styles.center} accessibilityLabel={t('chat.loading')} />;
  }

  if (chat.state === 'not_member') {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>{t('chat.nonMember')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.backToActivity')}
          style={styles.primary}
          onPress={() => router.replace(`/activites/${activityId}`)}
        >
          <Text style={styles.primaryText}>{t('chat.backToActivity')}</Text>
        </Pressable>
      </View>
    );
  }

  const MuteIcon = chat.muted ? BellOff : Bell;
  const muteLabel = chat.muted ? t('chat.unmute') : t('chat.mute');

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.actions.back')}
          style={styles.iconButton}
          onPress={() => router.back()}
        >
          <ChevronLeft size={24} color="#1a56db" />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>
          {chat.title ?? t('chat.title')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={muteLabel}
          accessibilityState={{ disabled: chat.muteBusy }}
          disabled={chat.muteBusy}
          style={[styles.iconButton, chat.muteBusy && styles.dim]}
          onPress={() => void chat.toggleMute()}
        >
          <MuteIcon size={22} color="#1a56db" />
        </Pressable>
      </View>

      {notice || chat.notice ? (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {notice ?? t(chat.notice === 'mute' ? 'chat.muteError' : 'chat.syncError')}
        </Text>
      ) : null}

      <FlatList
        testID="chat-list"
        accessibilityLabel={t('chat.listLabel')}
        style={styles.list}
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <MessageBubble message={item} onLongPress={setTarget} onRetry={chat.retry} />
        )}
        onEndReached={() => void chat.loadOlder()}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.empty}>{t('chat.empty')}</Text>}
      />

      {chat.archived ? (
        <Text accessibilityLiveRegion="polite" style={styles.archived}>{t('chat.archived')}</Text>
      ) : (
        <Composer onSend={chat.send} />
      )}

      <MessageActions
        target={target}
        onClose={() => setTarget(null)}
        onDelete={confirmDelete}
        onDiscard={(m) => {
          setTarget(null);
          chat.discard(m.id);
        }}
        onReport={report}
        onBlock={blockSender}
      />
      {reportSheet}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, marginTop: 80, padding: 16, alignItems: 'center', gap: 12 },
  centerText: { textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 4, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
  empty: { textAlign: 'center', padding: 24, color: '#6b7280', transform: [{ scaleY: -1 }] },
  notice: { backgroundColor: '#eef2ff', color: '#1a3a9e', padding: 10, textAlign: 'center' },
  archived: { backgroundColor: '#f3f4f6', color: '#374151', padding: 14, textAlign: 'center' },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  dim: { opacity: 0.5 },
});
