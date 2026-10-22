import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

export default function Profile() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text>{t('common.comingSoon')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
