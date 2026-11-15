# QueueEase

[![CI](https://github.com/mishalsheza/QueueEase/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mishalsheza/QueueEase/actions/workflows/ci.yml)

- `backend/`: Node.js + Express + MongoDB API with Socket.IO
- `mobile/`: Expo (React Native) app
- `docs/architecture.md`: how the pieces fit together

## Running locally

```bash
cd backend && cp .env.example .env   # then set JWT_SECRET (see the file)
npm install && npm run dev

cd mobile && cp .env.example .env
npm install && npx expo start
```

## Checks (what CI runs on Node 22)

```bash
cd backend && npm test                                     # in-memory MongoDB, no .env needed
cd mobile && npx tsc --noEmit && npm run lint && npm test
```
