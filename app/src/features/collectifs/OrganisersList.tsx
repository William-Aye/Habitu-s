import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PersonAvatar } from '../activities/PersonAvatar';
import type { CollectifPage } from '../activities/types';

/** First names and photos of the active organisers, the responsable first. */
export function OrganisersList({ organisers }: { organisers: CollectifPage['organisers'] }) {
  const { t } = useTranslation();
  // Signed-out visitors get the roles only (no names or photos): show how many organisers there are.
  if (organisers.length > 0 && organisers.every((o) => !o.firstName)) {
    return <Text>{t('collectif.organisersCount', { count: organisers.length })}</Text>;
  }
  return (
    <View style={styles.list}>
      {organisers.map((o, i) => (
        <View key={`${o.firstName}-${i}`} style={styles.row}>
          <PersonAvatar name={o.firstName} photoUrl={o.photoUrl} />
          <Text style={styles.name}>{o.firstName}</Text>
          <Text style={styles.role}>{t(`collectif.role.${o.role}`)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  name: { fontSize: 16, fontWeight: '600' },
  role: { fontSize: 13, color: '#555' },
});
