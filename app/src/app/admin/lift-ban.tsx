import { useTranslation } from 'react-i18next';
import { LiftBan } from '../../features/admin/LiftBan';
import { AdminScreen } from '../../features/admin/ui';

export default function LiftBanScreen() {
  const { t } = useTranslation();
  return (
    <AdminScreen title={t('admin.liftBan.title')}>
      <LiftBan />
    </AdminScreen>
  );
}
