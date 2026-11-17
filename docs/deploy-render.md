# Deploying the API to Render

The backend runs as one Render web service, defined in
[`render.yaml`](../render.yaml) at the repo root, with the data in MongoDB
Atlas. The mobile app then points at the service's URL.

| Setting | Value |
| --- | --- |
| Code | `backend/` (changes elsewhere don't redeploy) |
| Build / start | `npm ci --omit=dev` / `node src/server.js`, Node 22 |
| Health check | `GET /api/health`: 200 only while MongoDB is connected |
| Deploys | Automatic on push to `main`, only after CI passes |
| Plan / region | `free` / `singapore`. Change the region in `render.yaml` **before** creating the service to the one nearest your Atlas cluster. It can't be changed later. |

## 1. Before you start (Atlas)

**a. A database user for Render.** Atlas → Database Access → Add New Database User:

- Username `queueease-render`, password from **Autogenerate Secure Password**
  (letters and digits only, so it needs no escaping in the URI).
- Database User Privileges → Add Specific Privilege → `readWrite` on database
  `queueease`. That is everything the API needs, including creating its indexes.

Using a separate user means you can rotate or revoke Render's access without
touching your own.

**b. Existing data.** If the Atlas `queueease` database has data from before
A4 and you haven't run these against it yet, run them once from your machine,
with `MONGO_URI` in `backend/.env` pointing at Atlas. Do the dry run first,
read what it says, then `--apply`:

```bash
cd backend
node scripts/migrate_queue_model.js          # then: --apply
node scripts/sync_indexes.js                 # then: --apply (drops the old user_1_status_1 index)
```

An empty database needs neither: the server creates its indexes on startup.

## 2. Create the service

1. Render Dashboard → **New** → **Blueprint** → connect GitHub and pick
   `mishalsheza/QueueEase`. Render reads `render.yaml` from `main`.
2. It asks for the two `sync: false` values. Fill them in from the checklist
   below, then **Apply**.
3. The first deploy will probably fail its health check with "Server
   selection timed out" in the logs: Atlas doesn't allow Render's addresses
   yet. Do step 3, then **Manual Deploy → Deploy latest commit**.

## Environment variable checklist

Service → **Environment**. After the Blueprint is applied, check that it matches this:

| Variable | Value | Set by |
| --- | --- | --- |
| `MONGO_URI` | `mongodb+srv://queueease-render:<password>@<cluster>.mongodb.net/queueease?retryWrites=true&w=majority&appName=queueease-render` | You, when creating the Blueprint |
| `JWT_SECRET` | A random 44-character value | Render (`generateValue`). Don't paste your local one. |
| `CORS_ORIGINS` | `http://localhost:8081`, or your deployed web app's origin(s), comma-separated | You, when creating the Blueprint |
| `TRUST_PROXY` | `1` | Blueprint (check it after the first deploy, see step 4) |
| `NODE_VERSION` | `22` | Blueprint |

Notes:

- **`MONGO_URI`**:
  - Copy `<cluster>.mongodb.net` from Atlas → Connect → Drivers.
  - The app always uses the `queueease` database (`config/db.js`), so `/queueease` in the URI is for clarity only. It doesn't change the database.
  - If your password has characters like `@ : / ? #`, they must be percent-encoded.
- **`JWT_SECRET`**: changing it later signs everyone out.
- **`CORS_ORIGINS`**:
  - The native app sends no `Origin` and doesn't need an entry.
  - `http://localhost:8081` lets Expo web on your machine use the deployed API.
  - Logins use bearer tokens, not cookies, so listing it is low risk.
  - It can't be empty: the server refuses to start without at least one origin.

**Don't set:**

- `PORT`: Render provides it, and the server reads it.
- `NODE_ENV`: not used by the server. `test` would weaken `seed_db`'s guard.
- `ADMIN_PASSWORD`: only used by `create_admin`, on your machine.
- `AUTH_RATE_LIMIT_*`: the defaults (20 attempts per 15 min) are fine.

## 3. Atlas Network Access

Atlas → Network Access → **Add IP Address**:

- **Recommended:** Render service page → **Connect** (top right) → **Outbound**.
  Add each CIDR range listed there, with the comment "Render queueease-api".
  These ranges are shared by every Render service in the region, so they narrow
  access but don't make it exclusive. The database user's password still
  protects the data.
- **If no outbound ranges are shown for your service:** `0.0.0.0/0` (allow
  from anywhere). This is common on free tiers, but then the
  `queueease-render` password is the only barrier, so keep it long and random.

Keep your own IP entry: you need it to run `create_admin` and the scripts
against Atlas.

## 4. After the first deploy

The service URL is at the top of the service page, e.g.
`https://queueease-api.onrender.com`. Render adds a suffix if the name is
taken.

**Health:**

```bash
curl https://queueease-api.onrender.com/api/health
# {"status":"ok","db":"connected"}
```

The logs should show `MongoDB connected`, `Database: queueease`, and no
`ERR_ERL_` warnings from the rate limiter.

**First admin.** Render's free plan has no shell, so run this from your machine
with `backend/.env` pointing at the same Atlas cluster:

```bash
cd backend
ADMIN_PASSWORD='...' node scripts/create_admin.js --name "Your Name" --email you@example.com
```

**Check `TRUST_PROXY`.** Render doesn't document how many proxies sit in front
of the app, and the rate limiter needs `TRUST_PROXY` to match. Each request
below sends an empty register form: it gets a 400 and creates nothing, but it
uses 1 of your IP's 20 register attempts per 15 minutes.

```bash
URL=https://queueease-api.onrender.com
probe() { curl -s -o /dev/null -D - -X POST $URL/api/auth/register \
  -H 'content-type: application/json' "$@" -d '{}' | grep -i '^ratelimit:'; }
probe; probe                                   # remaining=19, then 18
probe -H 'X-Forwarded-For: 203.0.113.7'        # should be 17
```

Then run `probe` once from another network, such as your phone's hotspot.

| Result | Meaning |
| --- | --- |
| The fake header continues the count (17), and the other network starts fresh (19) | Correct: each client is counted separately and can't fake its IP. |
| The fake header starts a fresh count (19) | Clients can bypass the limit by sending the header. `TRUST_PROXY` is trusting too much. |
| The other network continues your count | Everyone shares one counter (the proxy's IP): one person's failed logins lock out everyone. Not enough hops are trusted. |

In either failing case, leave the service as it is and tell me the result.
`TRUST_PROXY` only accepts `1` today.

## 5. Point the Expo app at it

1. In `mobile/.env` (git-ignored), set the URL without `/api`:
   ```
   EXPO_PUBLIC_API_URL=https://queueease-api.onrender.com
   ```
2. Restart Expo with `npx expo start --clear`. The value is built into the
   bundle, and `--clear` makes sure the old one isn't reused.
3. REST and live updates both use it. The socket switches to `wss://` by itself.
   - **Expo Go on a phone:** it works on mobile data or any Wi-Fi. It doesn't need to be on the same network as your computer.
   - **Expo web:** its origin (`http://localhost:8081`) must be in `CORS_ORIGINS` on Render. Editing it there redeploys the service.
4. To go back to your local backend, empty the value and restart Expo with
   `--clear`.

**Release builds** (EAS) refuse to start without `EXPO_PUBLIC_API_URL`. Because
`mobile/.env` is git-ignored, it isn't uploaded to EAS's servers. Set the
variable in EAS when you get to builds:

```bash
eas env:create --name EXPO_PUBLIC_API_URL --value https://queueease-api.onrender.com --environment production --visibility plaintext
```

## Free plan behaviour

- **Spin-down:** the service stops after 15 minutes without requests. The next
  request wakes it, which can take about a minute.
  - The app's request timeout is 30 s, so the first request after a quiet period may fail. Retrying works.
  - Open sockets drop when it stops. The app reconnects.
  - You can wake it first with `curl $URL/api/health`.
- **Rate-limit counters** live in memory. They reset on every deploy and every
  spin-down.
- **Deploys:** pushes to `main` deploy only after the CI workflow passes
  (`autoDeployTrigger: checksPass`).

## Troubleshooting

| Log or symptom | Cause |
| --- | --- |
| `MongoDB connection failed: ... Server selection timed out` | Atlas Network Access doesn't allow Render (step 3) |
| `bad auth : authentication failed` | Wrong user or password in `MONGO_URI`, or a special character not percent-encoded |
| `Invalid configuration` and a list of variables | Missing or invalid variables. The message says "see backend/.env", but on Render they're in the Environment tab. |
| Deploy stuck "in progress", then failed | `/api/health` never returned 200. See the first row. |
| Browser shows a CORS error (web only) | The page's origin isn't in `CORS_ORIGINS` |

References:

- [Blueprint spec](https://render.com/docs/blueprint-spec)
- [Outbound IP addresses](https://render.com/docs/outbound-ip-addresses)
- [render.yaml JSON schema](https://render.com/schema/render.yaml.json)
