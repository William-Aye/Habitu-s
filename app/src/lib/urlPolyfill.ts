// React Native's URL is incomplete, and supabase-js needs a full one. Browsers have it already, so the web
// build uses urlPolyfill.web.ts (empty) and leaves this ~50 KB out of the page.
import 'react-native-url-polyfill/auto';
