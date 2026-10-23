import { render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { NotificationResponder } from '../src/features/notifications/NotificationResponder';
import { handleNotificationResponse } from '../src/features/notifications/responses';
import { setupNotificationCategories } from '../src/features/notifications/categories';

jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: jest.fn(),
  clearLastNotificationResponseAsync: jest.fn(async () => {}),
  addNotificationResponseReceivedListener: jest.fn(),
}));
jest.mock('../src/features/notifications/responses', () => ({ handleNotificationResponse: jest.fn(async () => {}) }));
jest.mock('../src/features/notifications/categories', () => ({ setupNotificationCategories: jest.fn(async () => {}) }));
const mockSession = { status: 'loading' as string };
jest.mock('../src/features/account/useSession', () => ({ useSession: () => mockSession }));

const N = Notifications as unknown as Record<string, jest.Mock>;
const handle = handleNotificationResponse as jest.Mock;
const remove = jest.fn();
const resp = { actionIdentifier: 'yes', notification: { request: { identifier: 'n1', content: { data: {} } } } };

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.status = 'ready';
  N.getLastNotificationResponseAsync.mockResolvedValue(null);
  N.addNotificationResponseReceivedListener.mockReturnValue({ remove });
});

it('sets up the categories at start', async () => {
  await render(<NotificationResponder />);
  expect(setupNotificationCategories).toHaveBeenCalled();
});

it('handles the response that cold-started the app', async () => {
  N.getLastNotificationResponseAsync.mockResolvedValue(resp);
  await render(<NotificationResponder />);
  await new Promise((r) => setTimeout(r, 0));
  expect(handle).toHaveBeenCalledWith(resp);
});

it('handles responses received while running, and stops listening on unmount', async () => {
  const view = await render(<NotificationResponder />);
  const listener = N.addNotificationResponseReceivedListener.mock.calls[0][0];
  listener(resp);
  expect(handle).toHaveBeenCalledWith(resp);
  await view.unmount();
  expect(remove).toHaveBeenCalled();
});

it('waits for the session before handling anything', async () => {
  mockSession.status = 'loading';
  N.getLastNotificationResponseAsync.mockResolvedValue(resp);
  await render(<NotificationResponder />);
  await new Promise((r) => setTimeout(r, 0));
  expect(handle).not.toHaveBeenCalled();
  expect(N.addNotificationResponseReceivedListener).not.toHaveBeenCalled();
});
