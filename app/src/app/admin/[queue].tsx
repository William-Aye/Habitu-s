import { Redirect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CategoriesQueue } from '../../features/admin/CategoriesQueue';
import { ClaimsQueue } from '../../features/admin/ClaimsQueue';
import { ClubsQueue } from '../../features/admin/ClubsQueue';
import { FeedbackQueue } from '../../features/admin/FeedbackQueue';
import { ReportsQueue } from '../../features/admin/ReportsQueue';
import { AdminScreen } from '../../features/admin/ui';

const SCREENS = {
  reports: ReportsQueue,
  claims: ClaimsQueue,
  clubs: ClubsQueue,
  categories: CategoriesQueue,
  feedback: FeedbackQueue,
} as const;

export default function AdminQueue() {
  const { t } = useTranslation();
  const { queue } = useLocalSearchParams<{ queue: string }>();
  if (!queue || !Object.prototype.hasOwnProperty.call(SCREENS, queue)) return <Redirect href="/admin" />;
  const Screen = SCREENS[queue as keyof typeof SCREENS];
  return (
    <AdminScreen title={t(`admin.queues.${queue}`)}>
      <Screen />
    </AdminScreen>
  );
}
