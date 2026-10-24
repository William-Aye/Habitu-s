import { t } from 'i18next';
import { Share } from 'react-native';
import { activityUrl } from '../../lib/links';

export async function shareActivity(id: string, title: string): Promise<'shared' | 'copied'> {
  const message = t('activities.share.message', {
    titre: title,
    url: activityUrl(id, title),
    interpolation: { escapeValue: false },
  });
  await Share.share({ message });
  return 'shared';
}
