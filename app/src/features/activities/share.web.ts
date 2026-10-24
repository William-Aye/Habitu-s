import { t } from 'i18next';
import { activityUrl, webBaseUrl } from '../../lib/links';

/** 'shared' once the browser's share sheet took it; 'copied' when the link went to the clipboard instead. */
export async function shareActivity(id: string, title: string): Promise<'shared' | 'copied'> {
  const text = t('activities.share.message', {
    titre: title,
    url: activityUrl(id, title, webBaseUrl() || window.location.origin),
    interpolation: { escapeValue: false },
  });
  if (typeof navigator.share === 'function') {
    await navigator.share({ text });
    return 'shared';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
