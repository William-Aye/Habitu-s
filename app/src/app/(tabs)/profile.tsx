import { Image } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRequireAccount } from '../../features/account/AccountGate';
import { MAX_FIRST_NAME, signOut } from '../../features/account/auth';
import { pickAndUploadAvatar } from '../../features/account/avatar';
import { currentCommune } from '../../features/account/homeArea';
import { deleteMyAccount, exportMyData } from '../../features/account/myData';
import { LocationPicker } from '../../features/explore/components/LocationPicker';
import type { HomeAreaInput } from '../../features/account/auth';
import { useSession, type SessionProfile } from '../../features/account/useSession';
import { setLanguage, type AppLanguage } from '../../i18n';
import { supabase } from '../../lib/supabase';

type Notice = { kind: 'ok' | 'error'; key: string } | null;

function LanguageSwitch({ onChange }: { onChange(lng: AppLanguage): void | Promise<unknown> }) {
  const { t, i18n } = useTranslation();
  const current: AppLanguage = i18n.language?.startsWith('en') ? 'en' : 'fr';
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('profile.language')}
      </Text>
      <View style={styles.row}>
        {(['fr', 'en'] as const).map((lng) => (
          <Pressable
            key={lng}
            accessibilityRole="button"
            accessibilityState={{ selected: current === lng }}
            accessibilityLabel={t(lng === 'fr' ? 'onboarding.french' : 'onboarding.english')}
            style={[styles.chip, current === lng && styles.chipOn]}
            onPress={() => onChange(lng)}
          >
            <Text style={current === lng ? styles.chipOnText : styles.chipText}>
              {t(lng === 'fr' ? 'onboarding.french' : 'onboarding.english')}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function Profile() {
  const { status, userId, profile, error, refresh } = useSession();
  // The session could not be read (offline): not the same as signed out.
  if (status === 'loading' && error) return <OfflineProfile onRetry={() => void refresh()} />;
  if (status === 'needs_profile') return <NeedsProfileProfile />;
  if (status !== 'ready' || !userId || !profile) return <SignedOutProfile />;
  return <SignedInProfile userId={userId} profile={profile} />;
}

function OfflineProfile({ onRetry }: { onRetry(): void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('profile.title')}
      </Text>
      <Text accessibilityLiveRegion="polite" style={styles.error}>
        {t('profile.offline')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('account.retry')}
        style={styles.primary}
        onPress={onRetry}
      >
        <Text style={styles.primaryText}>{t('account.retry')}</Text>
      </Pressable>
    </ScrollView>
  );
}

/** Asks for the deletion with the shared confirmation; `onStart`/`onDone` let the screen show progress. */
function useConfirmDelete(onStart: () => void, onDone: (ok: boolean) => void) {
  const { t } = useTranslation();
  return () => {
    Alert.alert(t('profile.deleteConfirm'), undefined, [
      { text: t('profile.cancel'), style: 'cancel' },
      {
        text: t('profile.deleteAction'),
        style: 'destructive',
        onPress: async () => {
          onStart();
          const res = await deleteMyAccount();
          onDone(res.ok);
        },
      },
    ]);
  };
}

/** Signed in but the profile is incomplete: finish, or leave (sign out / delete), never stuck. */
function NeedsProfileProfile() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const requireAccount = useRequireAccount();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirmDelete = useConfirmDelete(
    () => {
      setBusy(true);
      setFailed(false);
    },
    (ok) => {
      setBusy(false);
      setFailed(!ok);
    },
  );
  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('profile.title')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.finishSignup')}
        style={styles.primary}
        onPress={() => void requireAccount()}
      >
        <Text style={styles.primaryText}>{t('profile.finishSignup')}</Text>
      </Pressable>
      <LanguageSwitch onChange={(lng) => changeLanguage(lng, null)} />
      <PrivacyLink onPress={() => router.push('/privacy' as Href)} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.signOut')}
        style={styles.outline}
        onPress={() => void signOut()}
      >
        <Text style={styles.outlineText}>{t('profile.signOut')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.delete')}
        disabled={busy}
        style={styles.danger}
        onPress={confirmDelete}
      >
        <Text style={styles.dangerText}>{t('profile.delete')}</Text>
      </Pressable>
      {failed ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {t('profile.deleteError')}
        </Text>
      ) : null}
    </ScrollView>
  );
}

/** Shows the saved home town and lets the user change it (commune centre) or remove it. */
function HomeAreaSection({
  userId,
  label,
  onSaved,
  onError,
}: {
  userId: string;
  label: string | null;
  onSaved(): Promise<unknown>;
  onError(failed: boolean): void;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const write = async (patch: { home_area: string | null; home_area_label: string | null }) => {
    setBusy(true);
    onError(false);
    try {
      const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
      if (error) {
        onError(true);
      } else {
        setPicking(false);
        await onSaved();
      }
    } catch {
      onError(true);
    } finally {
      setBusy(false);
    }
  };
  const save = (area: HomeAreaInput) =>
    write({ home_area: `SRID=4326;POINT(${area.lon} ${area.lat})`, home_area_label: area.label });

  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('profile.homeArea')}
      </Text>
      <Text>{label ?? t('profile.homeAreaNone')}</Text>
      {picking ? (
        <LocationPicker
          onGps={async () => {
            const area = await currentCommune();
            if (area === 'denied') return 'denied';
            await save(area);
            return 'ok';
          }}
          onTown={(town) => void save({ label: town.label, lon: town.lon, lat: town.lat })}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('profile.homeAreaChange')}
            disabled={busy}
            style={styles.outline}
            onPress={() => setPicking(true)}
          >
            <Text style={styles.outlineText}>{t('profile.homeAreaChange')}</Text>
          </Pressable>
          {label ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile.homeAreaRemove')}
              disabled={busy}
              style={styles.outline}
              onPress={() => void write({ home_area: null, home_area_label: null })}
            >
              <Text style={styles.outlineText}>{t('profile.homeAreaRemove')}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

function SignedOutProfile() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const requireAccount = useRequireAccount();
  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('profile.title')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.signIn')}
        style={styles.primary}
        onPress={() => void requireAccount()}
      >
        <Text style={styles.primaryText}>{t('profile.signIn')}</Text>
      </Pressable>
      <LanguageSwitch onChange={(lng) => changeLanguage(lng, null)} />
      <PrivacyLink onPress={() => router.push('/privacy' as Href)} />
    </ScrollView>
  );
}

function PrivacyLink({ onPress }: { onPress(): void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t('account.privacy')}
      style={styles.link}
      onPress={onPress}
    >
      <Text style={styles.linkText}>{t('account.privacy')}</Text>
    </Pressable>
  );
}

/** Returns false when the profile copy could not be saved (the device keeps the choice). */
async function changeLanguage(lng: AppLanguage, userId: string | null): Promise<boolean> {
  await setLanguage(lng);
  if (!userId) return true;
  try {
    const { error } = await supabase.from('profiles').update({ language: lng }).eq('id', userId);
    return !error;
  } catch {
    return false;
  }
}

function SignedInProfile({ userId, profile }: { userId: string; profile: SessionProfile }) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useSession();

  const [firstName, setFirstName] = useState(profile.firstName);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<null | 'save' | 'photo' | 'export' | 'delete'>(null);

  const save = async () => {
    const name = firstName.trim();
    if (name.length === 0 || name.length > MAX_FIRST_NAME) {
      setNotice({ kind: 'error', key: 'account.errors.first_name' });
      return;
    }
    setBusy('save');
    setNotice(null);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ first_name: name, bio: bio.trim() || null })
        .eq('id', userId);
      if (error) {
        setNotice({ kind: 'error', key: 'profile.saveError' });
      } else {
        await refresh();
        setNotice({ kind: 'ok', key: 'profile.saved' });
      }
    } catch {
      setNotice({ kind: 'error', key: 'profile.saveError' });
    } finally {
      setBusy(null);
    }
  };

  const changePhoto = async () => {
    setBusy('photo');
    setNotice(null);
    const res = await pickAndUploadAvatar(userId);
    setBusy(null);
    if (res.ok) {
      await refresh();
    } else if (res.error === 'too_large') {
      setNotice({ kind: 'error', key: 'profile.photoTooLarge' });
    } else if (res.error === 'network') {
      setNotice({ kind: 'error', key: 'profile.photoError' });
    }
  };

  const download = async () => {
    setBusy('export');
    setNotice(null);
    const res = await exportMyData();
    setBusy(null);
    if (!res.ok) setNotice({ kind: 'error', key: 'profile.downloadError' });
  };

  const confirmDelete = useConfirmDelete(
    () => {
      setBusy('delete');
      setNotice(null);
    },
    (ok) => {
      setBusy(null);
      if (!ok) setNotice({ kind: 'error', key: 'profile.deleteError' });
    },
  );

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text accessibilityRole="header" style={styles.title}>
        {t('profile.title')}
      </Text>

      <View style={styles.photoRow}>
        {profile.photoUrl ? (
          <Image
            source={{ uri: profile.photoUrl }}
            accessibilityLabel={t('profile.photoAlt')}
            style={styles.photo}
          />
        ) : (
          <View style={[styles.photo, styles.photoEmpty]} />
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.changePhoto')}
          disabled={busy !== null}
          style={styles.outline}
          onPress={changePhoto}
        >
          <Text style={styles.outlineText}>{t('profile.changePhoto')}</Text>
        </Pressable>
        {busy === 'photo' ? <ActivityIndicator /> : null}
      </View>

      <Text style={styles.label}>{t('account.firstName')}</Text>
      <TextInput
        accessibilityLabel={t('account.firstName')}
        style={styles.input}
        value={firstName}
        onChangeText={setFirstName}
        maxLength={MAX_FIRST_NAME + 20}
        autoComplete="given-name"
      />
      <Text style={styles.label}>{t('profile.bio')}</Text>
      <TextInput
        accessibilityLabel={t('profile.bio')}
        style={[styles.input, styles.bio]}
        value={bio}
        onChangeText={setBio}
        multiline
        maxLength={500}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.save')}
        disabled={busy !== null}
        style={styles.primary}
        onPress={save}
      >
        <Text style={styles.primaryText}>{t('profile.save')}</Text>
      </Pressable>
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={notice.kind === 'error' ? styles.error : styles.ok}>
          {t(notice.key)}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('profile.interests')}
        style={styles.link}
        onPress={() => router.push('/interests' as Href)}
      >
        <Text style={styles.linkText}>{t('profile.interests')}</Text>
      </Pressable>

      <HomeAreaSection
        userId={userId}
        label={profile.homeAreaLabel}
        onSaved={refresh}
        onError={(failed) => setNotice(failed ? { kind: 'error', key: 'profile.homeAreaError' } : null)}
      />

      <LanguageSwitch
        onChange={async (lng) => {
          const ok = await changeLanguage(lng, userId);
          setNotice(ok ? null : { kind: 'error', key: 'profile.languageError' });
        }}
      />

      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('profile.myData')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.download')}
          disabled={busy !== null}
          style={styles.outline}
          onPress={download}
        >
          <Text style={styles.outlineText}>{t('profile.download')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('profile.delete')}
          disabled={busy !== null}
          style={styles.danger}
          onPress={confirmDelete}
        >
          <Text style={styles.dangerText}>{t('profile.delete')}</Text>
        </Pressable>
      </View>

      <PrivacyLink onPress={() => router.push('/privacy' as Href)} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('profile.signOut')}
        style={styles.outline}
        onPress={() => void signOut()}
      >
        <Text style={styles.outlineText}>{t('profile.signOut')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  group: { gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { width: 72, height: 72, borderRadius: 36 },
  photoEmpty: { backgroundColor: '#e5e7eb' },
  label: { fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, fontSize: 16, minHeight: 44 },
  bio: { minHeight: 88, textAlignVertical: 'top' },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: '#1a56db', justifyContent: 'center' },
  chipOn: { backgroundColor: '#1a56db' },
  chipText: { color: '#1a56db', fontWeight: '600' },
  chipOnText: { color: '#fff', fontWeight: '600' },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  outline: { minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#1a56db', paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  danger: { minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#b91c1c', alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: '#b91c1c', fontSize: 16, fontWeight: '600' },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
  error: { color: '#b91c1c' },
  ok: { color: '#15803d' },
});
