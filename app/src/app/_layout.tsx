import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { initI18n } from '../i18n';

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    initI18n()
      .catch((error: unknown) => {
        console.warn('i18n initialisation failed', error);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!ready) return null;

  return (
    <I18nextProvider i18n={i18next}>
      <Stack screenOptions={{ headerShown: false }} />
    </I18nextProvider>
  );
}
