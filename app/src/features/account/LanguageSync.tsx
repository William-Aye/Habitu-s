import i18next from 'i18next';
import { useEffect, useRef } from 'react';
import { setLanguage } from '../../i18n';
import { useSession } from './useSession';

/** On sign-in, the language saved in the profile replaces the device's if they differ (once per sign-in). */
export function LanguageSync() {
  const { status, userId, profile } = useSession();
  const appliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'ready' || !userId || !profile) {
      if (status === 'signed_out') appliedFor.current = null;
      return;
    }
    if (appliedFor.current === userId) return;
    appliedFor.current = userId;
    const current = i18next.language?.startsWith('en') ? 'en' : 'fr';
    if (profile.language !== current) void setLanguage(profile.language);
  }, [status, userId, profile]);
  return null;
}
