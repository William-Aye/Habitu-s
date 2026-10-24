import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MfaGate } from '../../features/admin/MfaGate';
import { useAdminRole } from '../../features/admin/useIsAdmin';

/** Only admins get in, and only after the second factor: every screen below sits inside MfaGate. */
export default function AdminLayout() {
  const { t } = useTranslation();
  const role = useAdminRole();
  if (role === 'loading') return <ActivityIndicator style={{ marginTop: 80 }} accessibilityLabel={t('admin.loading')} />;
  if (role !== 'admin') return <Redirect href="/" />;
  return (
    <MfaGate>
      <Stack screenOptions={{ headerShown: false }} />
    </MfaGate>
  );
}
