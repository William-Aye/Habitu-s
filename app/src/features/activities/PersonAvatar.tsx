import { Image, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

/** A round photo, or the first letter of the first name when there is none. */
export function PersonAvatar({ name, photoUrl, size = 36 }: { name: string; photoUrl: string | null; size?: number }) {
  const { t } = useTranslation();
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
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
  photo: { backgroundColor: '#e5e7eb' },
  fallback: { backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#1a3a9e', fontWeight: '700' },
});
