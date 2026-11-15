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

## Backend with Docker

Runs the API and its own MongoDB, with no `.env` needed:

```bash
docker compose up --build        # API on http://localhost:5001, health at /api/health
docker compose down              # add -v to also delete the data
```

A `JWT_SECRET` is generated on first start and kept in a volume. See
[docker-compose.yml](docker-compose.yml) for the optional settings and for
creating an admin.

## Checks (what CI runs on Node 22)

```bash
cd backend && npm test                                     # in-memory MongoDB, no .env needed
cd mobile && npx tsc --noEmit && npm run lint && npm test
```
