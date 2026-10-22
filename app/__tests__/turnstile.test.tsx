import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Turnstile } from '../src/features/account/Turnstile';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('yields an empty token at once without a site key', async () => {
  const onToken = jest.fn();
  const onError = jest.fn();
  await render(<Turnstile siteKey="" onToken={onToken} onError={onError} />);
  expect(onToken).toHaveBeenCalledWith('');
  expect(screen.queryByTestId('webview')).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(60000);
  });
  expect(onError).not.toHaveBeenCalled();
});

it('reports an error when no token arrives within 15 seconds', async () => {
  const onToken = jest.fn();
  const onError = jest.fn();
  await render(<Turnstile siteKey="site" onToken={onToken} onError={onError} />);
  await act(async () => {
    jest.advanceTimersByTime(14000);
  });
  expect(onError).not.toHaveBeenCalled();
  await act(async () => {
    jest.advanceTimersByTime(1500);
  });
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onToken).not.toHaveBeenCalled();
});

it('passes the token and cancels the timeout', async () => {
  const onToken = jest.fn();
  const onError = jest.fn();
  await render(<Turnstile siteKey="site" onToken={onToken} onError={onError} />);
  await fireEvent(screen.getByTestId('webview', { includeHiddenElements: true }), 'message', {
    nativeEvent: { data: JSON.stringify({ token: 'abc' }) },
  });
  expect(onToken).toHaveBeenCalledWith('abc');
  await act(async () => {
    jest.advanceTimersByTime(30000);
  });
  expect(onError).not.toHaveBeenCalled();
});
