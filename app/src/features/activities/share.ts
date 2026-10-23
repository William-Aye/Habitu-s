import { t } from 'i18next';
import { Share } from 'react-native';

/** Link to the activity: the website address when configured, else the app's own link. */
function activityUrl(id: string): string {
  const base = (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '').replace(/\/+$/, '');
  return base ? `${base}/activites/${id}` : `friendapp://activites/${id}`;
}

export async function shareActivity(id: string, title: string): Promise<void> {
  const message = t('activities.share.message', {
    titre: title,
    url: activityUrl(id),
    interpolation: { escapeValue: false },
  });
  await Share.share({ message });
}
