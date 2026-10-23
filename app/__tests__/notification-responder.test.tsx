import { render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { NotificationResponder } from '../src/features/notifications/NotificationResponder';
import { handleNotificationResponse, openActivityFor } from '../src/features/notifications/responses';
import { setupNotificationCategories } from '../src/features/notifications/categories';
import { refreshPushRegistration } from '../src/features/notifications/registerPush';

jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: jest.fn(),
  clearLastNotificationResponseAsync: jest.fn(async () => {}),
  addNotificationResponseReceivedListener: jest.fn(),
  addPushTokenListener: jest.fn(),
}));
jest.mock('../src/features/notifications/responses', () => ({
  handleNotificationResponse: jest.fn(async () => {}),
  openActivityFor: jest.fn(),
  responseKey: (r: any) => `${r.notification.request.identifier}:${r.actionIdentifier}`,
}));
jest.mock('../src/features/notifications/categories', () => ({ setupNotificationCategories: jest.fn(async () => {}) }));
jest.mock('../src/features/notifications/registerPush', () => ({ refreshPushRegistration: jest.fn(async () => 'registered') }));
const mockSession = { status: 'ready' as string, userId: 'A' as string | null };
jest.mock('../src/features/account/useSession', () => ({ useSession: () => mockSession }));

const N = Notifications as unknown as Record<string, jest.Mock>;
const handle = handleNotificationResponse as jest.Mock;
const open = openActivityFor as jest.Mock;
const remove = jest.fn();
const tokenRemove = jest.fn();
const resp = { actionIdentifier: 'yes', notification: { request: { identifier: 'n1', content: { data: {} } } } };
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.status = 'ready';
  mockSession.userId = 'A';
  N.getLastNotificationResponseAsync.mockResolvedValue(null);
  N.addNotificationResponseReceivedListener.mockReturnValue({ remove });
  N.addPushTokenListener.mockReturnValue({ remove: tokenRemove });
});

it('sets up the categories at start', async () => {
  await render(<NotificationResponder />);
  expect(setupNotificationCategories).toHaveBeenCalled();
});

it('handles the response that cold-started the app once ready', async () => {
  N.getLastNotificationResponseAsync.mockResolvedValue(resp);
  await render(<NotificationResponder />);
  await tick();
  expect(handle).toHaveBeenCalledWith(resp, { alreadyOpened: false });
});

it('handles live responses while ready, and stops listening on unmount', async () => {
  const view = await render(<NotificationResponder />);
  N.addNotificationResponseReceivedListener.mock.calls[0][0](resp);
  expect(handle).toHaveBeenCalledWith(resp, { alreadyOpened: false });
  await view.unmount();
  expect(remove).toHaveBeenCalled();
});

it('holds a response that arrives while loading and handles it once ready', async () => {
  mockSession.status = 'loading';
  const view = await render(<NotificationResponder />);
  N.addNotificationResponseReceivedListener.mock.calls[0][0](resp);
  await tick();
  expect(handle).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  mockSession.status = 'ready';
  await view.rerender(<NotificationResponder />);
  await tick();
  expect(handle).toHaveBeenCalledWith(resp, { alreadyOpened: false });
});

it('only opens the activity (account gate) for a signed-out user, then handles it after sign-in', async () => {
  mockSession.status = 'signed_out';
  mockSession.userId = null;
  const view = await render(<NotificationResponder />);
  N.addNotificationResponseReceivedListener.mock.calls[0][0](resp);
  expect(handle).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith(resp);
  mockSession.status = 'ready';
  mockSession.userId = 'A';
  await view.rerender(<NotificationResponder />);
  await tick();
  expect(handle).toHaveBeenCalledWith(resp, { alreadyOpened: true });
});

it('registers the push token once per launch when ready, without prompting', async () => {
  const view = await render(<NotificationResponder />);
  await view.rerender(<NotificationResponder />);
  await tick();
  expect(refreshPushRegistration).toHaveBeenCalledTimes(1);
});

it('does not register while signed out', async () => {
  mockSession.status = 'signed_out';
  await render(<NotificationResponder />);
  await tick();
  expect(refreshPushRegistration).not.toHaveBeenCalled();
});

it('registers again when the device token changes', async () => {
  await render(<NotificationResponder />);
  await tick();
  N.addPushTokenListener.mock.calls[0][0]({});
  await tick();
  expect(refreshPushRegistration).toHaveBeenCalledTimes(2);
});

it('registers again when a different user reaches ready', async () => {
  const view = await render(<NotificationResponder />);
  await tick();
  mockSession.userId = 'B';
  await view.rerender(<NotificationResponder />);
  await tick();
  expect(refreshPushRegistration).toHaveBeenCalledTimes(2);
});

it('drops the answer held for another user and only opens the activity', async () => {
  mockSession.status = 'needs_profile';
  mockSession.userId = 'A';
  const view = await render(<NotificationResponder />);
  N.addNotificationResponseReceivedListener.mock.calls[0][0](resp);
  mockSession.status = 'ready';
  mockSession.userId = 'B';
  await view.rerender(<NotificationResponder />);
  await tick();
  expect(handle).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledTimes(1);
});

it('forgets a held response on sign-out', async () => {
  mockSession.status = 'loading';
  mockSession.userId = null;
  const view = await render(<NotificationResponder />);
  N.addNotificationResponseReceivedListener.mock.calls[0][0](resp);
  mockSession.status = 'ready';
  mockSession.userId = 'A';
  await view.rerender(<NotificationResponder />);
  await tick();
  handle.mockClear();
  mockSession.status = 'signed_out';
  mockSession.userId = null;
  await view.rerender(<NotificationResponder />);
  mockSession.status = 'ready';
  mockSession.userId = 'B';
  await view.rerender(<NotificationResponder />);
  await tick();
  expect(handle).not.toHaveBeenCalled();
});

it('opens the activity once for a response across sign-in, then records the answer without navigating again', async () => {
  mockSession.status = 'signed_out';
  mockSession.userId = null;
  const view = await render(<NotificationResponder />);
  N.getLastNotificationResponseAsync.mockResolvedValue(resp);
  N.addNotificationResponseReceivedListener.mock.calls[0][0](resp);
  mockSession.status = 'needs_profile';
  mockSession.userId = 'A';
  await view.rerender(<NotificationResponder />);
  await tick();
  mockSession.status = 'ready';
  await view.rerender(<NotificationResponder />);
  await tick();
  expect(open).toHaveBeenCalledTimes(1);
  expect(handle).toHaveBeenCalledWith(resp, { alreadyOpened: true });
  expect(N.clearLastNotificationResponseAsync).toHaveBeenCalled();
});
