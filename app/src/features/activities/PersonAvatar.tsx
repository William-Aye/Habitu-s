import { Image, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { avatarUrl } from '../../lib/avatarUrl';
import { colors } from '../../lib/theme';

/** A round photo, or the first letter of the first name when there is none. `photoUrl` is photo_url (an avatar object name). */
export function PersonAvatar({ name, photoUrl, size = 36 }: { name: string; photoUrl: string | null; size?: number }) {
  const { t } = useTranslation();
  const box = { width: size, height: size, borderRadius: size / 2 };
  const uri = avatarUrl(photoUrl);
  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityLabel={t('activity.photoOf', { name })}
        style={[styles.photo, box]}
      />
    );
  }
  return (
    <View style={[styles.fallback, box]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.initial}>{name.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { backgroundColor: colors.surface },
  fallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  initial: { color: colors.accentDark, fontWeight: '700' },
});
