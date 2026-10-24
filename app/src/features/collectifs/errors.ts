import { useTranslation } from 'react-i18next';
import type { ApiError } from '../activities/types';

/** Collectif page error copy: a refused write, no connection, or anything else. */
export function useCollectifErrorText() {
  const { t } = useTranslation();
  return (e: ApiError) => t(`collectif.errors.${e === 'not_allowed' || e === 'network' || e === 'limit_reached' || e === 'content_refused' ? e : 'unknown'}`);
}
