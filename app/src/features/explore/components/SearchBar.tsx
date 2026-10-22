import { StyleSheet, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';

export function SearchBar({ value, onChange }: { value: string; onChange(v: string): void }) {
  const { t } = useTranslation();
  const placeholder = t('explore.searchPlaceholder');
  return (
    <TextInput
      style={styles.search}
      editable
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      accessibilityLabel={placeholder}
      returnKeyType="search"
      autoCorrect={false}
    />
  );
}

const styles = StyleSheet.create({
  search: {
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#ccc',
    paddingHorizontal: 16,
  },
});
