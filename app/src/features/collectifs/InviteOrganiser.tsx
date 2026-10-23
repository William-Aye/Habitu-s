import { UserPlus } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PersonAvatar } from '../activities/PersonAvatar';
import type { ApiError, Candidate } from '../activities/types';
import { inviteOrganiser, listCandidates } from './api';
import { useCollectifErrorText } from './errors';

type Load = { state: 'loading' } | { state: 'ready'; candidates: Candidate[] } | { state: 'error'; error: ApiError };

/** Members of the collectif's activities who could organise; the invitation is sent from here. */
export function InviteOrganiser({ collectifId, onClose }: { collectifId: string; onClose(): void }) {
  const { t } = useTranslation();
  const errorText = useCollectifErrorText();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [invitedName, setInvitedName] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listCandidates(collectifId).then((r) => {
      if (!active) return;
      setLoad(r.ok ? { state: 'ready', candidates: r.candidates } : { state: 'error', error: r.error });
    });
    return () => {
      active = false;
    };
  }, [collectifId]);

  const invite = async (c: Candidate) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setInvitedName(null);
    const result = await inviteOrganiser(collectifId, c.userId);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setInvitedName(c.firstName);
    setLoad((cur) =>
      cur.state === 'ready' ? { state: 'ready', candidates: cur.candidates.filter((x) => x.userId !== c.userId) } : cur,
    );
  };

  return (
    <View style={styles.box}>
      {load.state === 'loading' ? <ActivityIndicator accessibilityLabel={t('collectif.loading')} /> : null}
      {load.state === 'error' ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {errorText(load.error)}
        </Text>
      ) : null}
      {load.state === 'ready' && load.candidates.length === 0 ? <Text>{t('collectif.inviteNone')}</Text> : null}
      {load.state === 'ready'
        ? load.candidates.map((c) => (
            <View key={c.userId} style={styles.row}>
              <PersonAvatar name={c.firstName} photoUrl={c.photoUrl} />
              <Text style={styles.name}>{c.firstName}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('collectif.inviteName', { name: c.firstName })}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                style={[styles.invite, busy && styles.disabled]}
                onPress={() => invite(c)}
              >
                <UserPlus size={16} color="#1a56db" />
                <Text style={styles.inviteText}>{t('collectif.inviteAction')}</Text>
              </Pressable>
            </View>
          ))
        : null}
      <View accessibilityLiveRegion="polite">
        {invitedName ? <Text>{t('collectif.invited', { name: invitedName })}</Text> : null}
        {error ? <Text style={styles.error}>{errorText(error)}</Text> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('collectif.close')} style={styles.link} onPress={onClose}>
        <Text style={styles.linkText}>{t('collectif.close')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  name: { flex: 1, fontSize: 16, fontWeight: '600' },
  invite: {
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1a56db',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inviteText: { color: '#1a56db', fontWeight: '600' },
  disabled: { opacity: 0.4 },
  error: { color: '#b91c1c' },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
});
