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
