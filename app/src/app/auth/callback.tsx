import { Redirect } from 'expo-router';

/** Only the website receives the Google sign-in return (callback.web.tsx); the app has nothing here. */
export default function AuthCallbackNative() {
  return <Redirect href="/" />;
}
