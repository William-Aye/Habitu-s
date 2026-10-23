import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { setAttendance, setAttendanceStatus } from '../src/features/activities/api';
import { Platform } from 'react-native';
import { askForPush, refreshPushRegistration, registerForPush, unregisterThisDevice } from '../src/features/notifications/registerPush';
import { setupNotificationCategories } from '../src/features/notifications/categories';
import {
  handleNotificationResponse,
  openActivityFor,
  resetHandledResponsesForTests,
} from '../src/features/notifications/responses';
import { supabase } from '../src/lib/supabase';
import { initI18n } from '../src/i18n';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-device', () => ({ isDevice: true }));
const mockDeleteEq = jest.fn(async () => ({ error: null }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } },
}));
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  AndroidImportance: { MIN: 3, DEFAULT: 5, HIGH: 6 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('../src/features/activities/api', () => ({ setAttendance: jest.fn(), setAttendanceStatus: jest.fn() }));
jest.mock('../src/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn(() => ({ delete: () => ({ eq: mockDeleteEq }) })) },
}));

const N = Notifications as unknown as Record<string, jest.Mock>;
const rpc = supabase.rpc as unknown as jest.Mock;
const mockSetAttendance = setAttendanceStatus as jest.Mock;
const mockSetAttendanceFull = setAttendance as jest.Mock;

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

describe('android channel', () => {
  it('creates a high importance channel so the reminder shows a heads-up', async () => {
    const original = Platform.OS;
    Platform.OS = 'android';
    try {
      await registerForPush();
    } finally {
      Platform.OS = original;
    }
    expect(N.setNotificationChannelAsync).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ importance: 6 }),
    );
  });
});

describe('refreshPushRegistration', () => {
  it('registers the token without prompting when permission is already granted', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    await AsyncStorage.setItem('push.deniedAt', String(Date.now()));
    expect(await refreshPushRegistration()).toBe('registered');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('register_push_token', expect.anything());
    expect(await AsyncStorage.getItem('push.deniedAt')).toBeNull();
  });

  it('never prompts when permission is undetermined', async () => {
    expect(await refreshPushRegistration()).toBe('denied');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('unregisterThisDevice', () => {
  it('deletes this device token for the signed-out user', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    await unregisterThisDevice();
    expect(supabase.from).toHaveBeenCalledWith('push_tokens');
    expect(mockDeleteEq).toHaveBeenCalledWith('token', 'ExponentPushToken[abc]');
  });

  it('never throws or prompts', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    N.getExpoPushTokenAsync.mockRejectedValue(new Error('boom'));
    await expect(unregisterThisDevice()).resolves.toBeUndefined();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('askForPush', () => {
  it('relies on the launch registration when already granted', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'granted', canAskAgain: true });
    await AsyncStorage.setItem('push.deniedAt', String(Date.now()));
    await askForPush();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('push.deniedAt')).toBeNull();
  });

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
  it('yes confirms attendance, sending only the status so an existing guest is kept', async () => {
    await handleNotificationResponse(response('yes'));
    expect(mockSetAttendance).toHaveBeenCalledWith('s1', 'confirmed');
    expect(mockSetAttendanceFull).not.toHaveBeenCalled();
  });

  it('no cancels attendance', async () => {
    await handleNotificationResponse(response('no'));
    expect(mockSetAttendance).toHaveBeenCalledWith('s1', 'cancelled');
  });

  it('a default tap opens the activity and records nothing', async () => {
    await handleNotificationResponse(response(Notifications.DEFAULT_ACTION_IDENTIFIER));
    expect(mockSetAttendance).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/activites/[id]', params: { id: 'a1' } });
  });

  it('still opens the activity, flagged, when the answer cannot be recorded', async () => {
    mockSetAttendance.mockResolvedValue({ ok: false, error: 'network' });
    await handleNotificationResponse(response('yes'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/activites/[id]',
      params: { id: 'a1', reminder: 'failed' },
    });
  });

  it('opens the activity without recording anything when only navigating', async () => {
    openActivityFor(response('yes'));
    expect(mockSetAttendance).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/activites/[id]', params: { id: 'a1' } });
    await handleNotificationResponse(response('yes'));
    expect(mockSetAttendance).toHaveBeenCalledTimes(1);
  });

  it('does not navigate again when the activity was already opened, unless the answer failed', async () => {
    await handleNotificationResponse(response('yes', 'o1'), { alreadyOpened: true });
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    mockSetAttendance.mockResolvedValue({ ok: false, error: 'network' });
    await handleNotificationResponse(response('yes', 'o2'), { alreadyOpened: true });
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/activites/[id]',
      params: { id: 'a1', reminder: 'failed' },
    });
  });

  it('handles the same response only once', async () => {
    await handleNotificationResponse(response('yes'));
    await handleNotificationResponse(response('yes'));
    expect(mockSetAttendance).toHaveBeenCalledTimes(1);
  });

  it('opens the collectif page for an invitation notification', async () => {
    const invite = {
      actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
      notification: { request: { identifier: 'c1', content: { data: { collectif_id: 'col1' } } } },
    } as never;
    await handleNotificationResponse(invite);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/collectifs/[id]', params: { id: 'col1' } });
    (router.push as jest.Mock).mockClear();
    openActivityFor({ ...(invite as object), notification: { request: { identifier: 'c2', content: { data: { collectif_id: 'col1' } } } } } as never);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/collectifs/[id]', params: { id: 'col1' } });
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

describe('chat notification taps', () => {
  const chatResponse = (action = Notifications.DEFAULT_ACTION_IDENTIFIER, id = 'c1') =>
    ({
      actionIdentifier: action,
      notification: { request: { identifier: id, content: { data: { activity_id: 'a7', kind: 'chat_message' } } } },
    }) as never;

  it('opens the discussion instead of the activity page', async () => {
    await handleNotificationResponse(chatResponse());
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/discussions/a7');
  });

  it('does not navigate again when already opened, and records nothing', async () => {
    await handleNotificationResponse(chatResponse(Notifications.DEFAULT_ACTION_IDENTIFIER, 'c2'), { alreadyOpened: true });
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(mockSetAttendance).not.toHaveBeenCalled();
  });

  it('openActivityFor goes to the discussion for a chat message', () => {
    openActivityFor(chatResponse());
    expect(router.push).toHaveBeenCalledWith('/discussions/a7');
  });
});
