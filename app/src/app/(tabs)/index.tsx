import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

export default function Explore() {
  const { t } = useTranslation();
  const placeholder = t('explore.searchPlaceholder');
  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        editable={false}
        placeholder={placeholder}
        accessibilityLabel={placeholder}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 56 },
  search: {
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#ccc',
    paddingHorizontal: 16,
  },
});
