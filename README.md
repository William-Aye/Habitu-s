# Friend App

Une application francaise pour se faire des amis grace a des activites recurrentes (Expo Android + Supabase).

## Prerequisites

- Node 22 LTS or newer
- Docker Desktop (running)
- Android Studio with an emulator (API 34+)
- Git

## Local database

```bash
npm install
npm run db:start   # start local Supabase
npm run db:reset   # apply migrations
npm run db:test    # run pgTAP tests
npm run db:types   # generate TypeScript types
```

## Local ports

The local Supabase stack uses ports in the 553xx range instead of the 543xx defaults, because Windows reserves TCP 54190-54589 (Hyper-V/WSL) and `supabase start` fails to bind there.

| Service | Port |
| --- | --- |
| API (use `http://127.0.0.1:55321`) | 55321 |
| Database | 55322 |
| Studio | 55323 |
| Inbucket (mail) | 55324 |
| Analytics | 55327 |
| Pooler | 55329 |
| Shadow database | 55320 |
