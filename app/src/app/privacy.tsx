import { ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { privacyEn } from '../content/privacy.en';
import { privacyFr } from '../content/privacy.fr';

export type PrivacyBlock = { kind: 'heading' | 'text'; text: string };

/** Blank lines separate blocks; a block starting with "# " is a heading. No Markdown library. */
export function splitPrivacy(source: string): PrivacyBlock[] {
  return source
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .map((b) =>
      b.startsWith('# ')
        ? { kind: 'heading' as const, text: b.slice(2).trim() }
        : { kind: 'text' as const, text: b },
    );
}

export default function Privacy() {
  const { i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const blocks = splitPrivacy(i18n.language?.startsWith('en') ? privacyEn : privacyFr);
  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 12 }]}>
      {blocks.map((b, i) =>
        b.kind === 'heading' ? (
          <Text key={i} accessibilityRole="header" style={styles.heading}>
            {b.text}
          </Text>
        ) : (
          <Text key={i} style={styles.text}>
            {b.text}
          </Text>
        ),
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  heading: { fontSize: 20, fontWeight: '700', marginTop: 8 },
  text: { fontSize: 16, lineHeight: 23 },
});
