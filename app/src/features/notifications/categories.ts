import { t } from 'i18next';
import * as Notifications from 'expo-notifications';

export const REMINDER_CATEGORY = 'session_reminder';

/** Shows notifications while the app is open, and registers the day-before reminder's two actions. */
export async function setupNotificationCategories(): Promise<void> {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    // Both actions open the app briefly: simpler and more reliable than background handling.
    await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
      { identifier: 'yes', buttonTitle: t('notifications.yes'), options: { opensAppToForeground: true } },
      { identifier: 'no', buttonTitle: t('notifications.no'), options: { opensAppToForeground: true } },
    ]);
  } catch {
    // Notifications unavailable (web, simulator): nothing to set up.
  }
}
