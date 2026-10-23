import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { setAttendance } from '../src/features/activities/api';
import { askForPush, registerForPush } from '../src/features/notifications/registerPush';
import { setupNotificationCategories } from '../src/features/notifications/categories';
import {
  handleNotificationResponse,
  resetHandledResponsesForTests,
} from '../src/features/notifications/responses';
import { supabase } from '../src/lib/supabase';
import { initI18n } from '../src/i18n';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } },
}));
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('../src/features/activities/api', () => ({ setAttendance: jest.fn() }));
jest.mock('../src/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const N = Notifications as unknown as Record<string, jest.Mock>;
const rpc = supabase.rpc as unknown as jest.Mock;
const mockSetAttendance = setAttendance as jest.Mock;

const DAY = 24 * 3600 * 1000;

beforeAll(async () => {
  await initI18n();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetHandledResponsesForTests();
  N.getPermissionsAsync.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  N.requestPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
  N.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
  rpc.mockResolvedValue({ data: null, error: null });
  mockSetAttendance.mockResolvedValue({ ok: true });
});

describe('registerForPush', () => {
  it('asks permission, gets the token with the project id and registers it', async () => {
    expect(await registerForPush()).toBe('registered');
    expect(N.requestPermissionsAsync).toHaveBeenCalled();
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
    expect(rpc).toHaveBeenCalledWith('register_push_token', {
      p_token: 'ExponentPushToken[abc]',
      p_platform: expect.stringMatching(/^(android|ios)$/),
    });
  });

  it('does not ask again when permission is already granted', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    expect(await registerForPush()).toBe('registered');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns denied when the user refuses', async () => {
    N.requestPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: false });
    expect(await registerForPush()).toBe('denied');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is unavailable when anything throws', async () => {
    N.getExpoPushTokenAsync.mockRejectedValue(new Error('no fcm'));
    expect(await registerForPush()).toBe('unavailable');
  });

  it('is unavailable when the server refuses the token', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await registerForPush()).toBe('unavailable');
  });
});

describe('askForPush', () => {
  it('remembers a refusal and does not ask again for 30 days', async () => {
    N.requestPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: true });
    await askForPush();
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem('push.deniedAt')).not.toBeNull();

    await askForPush();
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('asks again after 30 days', async () => {
    await AsyncStorage.setItem('push.deniedAt', String(Date.now() - 31 * DAY));
    await askForPush();
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not ask within 30 days', async () => {
    await AsyncStorage.setItem('push.deniedAt', String(Date.now() - 5 * DAY));
    await askForPush();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    N.getPermissionsAsync.mockRejectedValue(new Error('boom'));
    await expect(askForPush()).resolves.toBeUndefined();
  });
});

describe('categories', () => {
  it('registers session_reminder with Oui and Pas cette fois, both opening the app', async () => {
    await setupNotificationCategories();
    expect(N.setNotificationCategoryAsync).toHaveBeenCalledWith('session_reminder', [
      { identifier: 'yes', buttonTitle: 'Oui', options: { opensAppToForeground: true } },
      { identifier: 'no', buttonTitle: 'Pas cette fois', options: { opensAppToForeground: true } },
    ]);
  });
});

function response(action: string, id = 'n1') {
  return {
    actionIdentifier: action,
    notification: {
      request: { identifier: id, content: { data: { session_id: 's1', activity_id: 'a1' } } },
    },
  } as never;
}

describe('handleNotificationResponse', () => {
  it('yes confirms attendance without a guest', async () => {
    await handleNotificationResponse(response('yes'));
    expect(mockSetAttendance).toHaveBeenCalledWith('s1', 'confirmed', 0);
  });

  it('no cancels attendance', async () => {
    await handleNotificationResponse(response('no'));
    expect(mockSetAttendance).toHaveBeenCalledWith('s1', 'cancelled', 0);
  });

  it('a default tap opens the activity and records nothing', async () => {
    await handleNotificationResponse(response(Notifications.DEFAULT_ACTION_IDENTIFIER));
    expect(mockSetAttendance).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/activites/[id]', params: { id: 'a1' } });
  });

  it('handles the same response only once', async () => {
    await handleNotificationResponse(response('yes'));
    await handleNotificationResponse(response('yes'));
    expect(mockSetAttendance).toHaveBeenCalledTimes(1);
  });

  it('ignores a payload without ids', async () => {
    await handleNotificationResponse({
      actionIdentifier: 'yes',
      notification: { request: { identifier: 'x', content: { data: {} } } },
    } as never);
    expect(mockSetAttendance).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
