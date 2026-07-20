# Vercel frontend + laptop backend

The same repository supports two deployment modes:

- `backend`: the laptop runs both the Next.js backend and WAHA as Docker containers; it also owns SQLite and the worker.
- `frontend`: Vercel serves the dashboard and securely rewrites authenticated API requests to the laptop tunnel.

WAHA itself stays bound to `127.0.0.1:3100` and must never be exposed by the tunnel.

## 1. Laptop environment

Update `.env.local` without committing it:

```dotenv
DEPLOYMENT_MODE=backend
WAHA_API_URL=http://127.0.0.1:3100
BACKEND_INTERNAL_URL=http://127.0.0.1:3101
DASHBOARD_PASSWORD=CHOOSE_A_STRONG_PASSWORD
DASHBOARD_SESSION_SECRET=GENERATE_RANDOM_VALUE_1
GATEWAY_SHARED_SECRET=GENERATE_RANDOM_VALUE_2
```

Generate each random value independently:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep all existing WAHA, proxy, campaign, and AI variables in `.env.local`.

Build, start, and verify both laptop containers:

```powershell
docker compose --env-file .env.local -f docker-compose.waha.yml up -d --build
```

In a second terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3100/api/version -Headers @{ "X-Api-Key" = "YOUR_WAHA_API_KEY" }
Invoke-RestMethod http://127.0.0.1:3101/api/campaign/status
```

## 2. HTTPS tunnel

Create a named Cloudflare Tunnel whose public hostname (for example `api.example.com`) points only to:

```text
http://127.0.0.1:3101
```

Do not point the tunnel to port `3100`. The backend rejects public requests that do not contain the Vercel gateway secret.

Run `cloudflared` as a Windows service so it starts after reboot. The tunnel on Windows points to the backend container through `127.0.0.1:3101`. The resulting public HTTPS URL becomes `FRONTEND_GATEWAY_URL` on Vercel.

## 3. Vercel environment

Import the Git repository into Vercel and add these Production, Preview, and Development environment variables:

```dotenv
DEPLOYMENT_MODE=frontend
FRONTEND_GATEWAY_URL=https://api.example.com
DASHBOARD_PASSWORD=THE_SAME_DASHBOARD_PASSWORD
DASHBOARD_SESSION_SECRET=THE_SAME_RANDOM_VALUE_1
GATEWAY_SHARED_SECRET=THE_SAME_RANDOM_VALUE_2
```

Do not add `WAHA_API_KEY`, the mobile proxy credentials, or AI keys to the Vercel project. They belong only on the laptop backend.

Deploy the project. Visitors are redirected to `/login`; after login, the browser talks only to the Vercel domain. Vercel adds the backend gateway secret server-side.

## 4. Laptop availability

Disable Windows sleep while plugged in and configure Docker Desktop and `cloudflared` to start automatically. Docker's restart policy starts both backend containers. If the laptop, internet connection, containers, or tunnel stops, the Vercel dashboard remains online but API operations will fail until the laptop returns.

## Security checks

- `https://api.example.com/` should return `404`.
- `https://api.example.com/api/monitor` without the private gateway header should return `401`.
- The Vercel dashboard should redirect to `/login` in a private browser window.
- Never commit `.env.local`, the `.waha` sessions directory, SQLite data, or Cloudflare credentials.
