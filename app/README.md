# Friend App (mobile)

Expo / React Native Android app for the Friend App. It talks to the Supabase project defined in `../supabase`.

## Setup

- `npm install`
- Copy `.env.example` to `.env` (git-ignored). For the local Supabase stack the API is `http://127.0.0.1:55321`; the anon key comes from `npx supabase status` at the repo root.

## Tests

`npm test`

## Running on Android

`npx expo run:android` needs Android Studio (Android SDK) and a running emulator or connected device.
