import { act, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { InterestsMerger } from '../src/features/interests/InterestsMerger';
import { hasLocalInterests, mergeLocalIntoAccount } from '../src/features/interests/store';

jest.mock('../src/features/interests/store', () => ({
  hasLocalInterests: jest.fn(),
  mergeLocalIntoAccount: jest.fn(),
}));
const mockSession = { status: 'loading' as string, userId: null as string | null };
jest.mock('../src/features/account/useSession', () => ({
  useSession: () => ({ ...mockSession, profile: null, error: false, refresh: jest.fn() }),
}));

const has = hasLocalInterests as jest.Mock;
const merge = mergeLocalIntoAccount as jest.Mock;
let appStateHandler: ((s: string) => void) | undefined;

beforeEach(() => {
  jest.resetAllMocks();
  mockSession.status = 'loading';
  mockSession.userId = null;
  has.mockResolvedValue(true);
  merge.mockResolvedValue(undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
    appStateHandler = h;
    return { remove: jest.fn() };
  }) as never);
});

it('merges stranded local interests once the session becomes ready (no sign-up sheet involved)', async () => {
  const { rerender } = await render(<InterestsMerger />);
  expect(merge).not.toHaveBeenCalled();
  mockSession.status = 'ready';
  mockSession.userId = 'u1';
  await rerender(<InterestsMerger />);
  await waitFor(() => expect(merge).toHaveBeenCalledWith('u1'));
});

it('does nothing when there are no local interests', async () => {
  has.mockResolvedValue(false);
  mockSession.status = 'ready';
  mockSession.userId = 'u1';
  await render(<InterestsMerger />);
  await waitFor(() => expect(has).toHaveBeenCalled());
  expect(merge).not.toHaveBeenCalled();
});

it('does not merge for a user without a complete profile', async () => {
  mockSession.status = 'needs_profile';
  mockSession.userId = 'u1';
  await render(<InterestsMerger />);
  expect(has).not.toHaveBeenCalled();
  expect(merge).not.toHaveBeenCalled();
});

it('retries a failed merge on the next foreground, logging only a generic message', async () => {
  merge.mockRejectedValueOnce(new Error('boom u1 love'));
  mockSession.status = 'ready';
  mockSession.userId = 'u1';
  await render(<InterestsMerger />);
  await waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
  expect(console.warn).toHaveBeenCalledWith('interests merge failed');
  await act(async () => {
    appStateHandler?.('active');
  });
  await waitFor(() => expect(merge).toHaveBeenCalledTimes(2));
});
