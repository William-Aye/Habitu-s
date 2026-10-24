import { t } from 'i18next';

/** Link to the activity page on the website. */
function activityUrl(id: string): string {
  const base = (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '').replace(/\/+$/, '') || window.location.origin;
  return `${base}/activites/${id}`;
}

/** 'shared' once the browser's share sheet took it; 'copied' when the link went to the clipboard instead. */
export async function shareActivity(id: string, title: string): Promise<'shared' | 'copied'> {
  const text = t('activities.share.message', {
    titre: title,
    url: activityUrl(id),
    interpolation: { escapeValue: false },
  });
  if (typeof navigator.share === 'function') {
    await navigator.share({ text });
    return 'shared';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
