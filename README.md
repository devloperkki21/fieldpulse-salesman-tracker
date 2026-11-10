# FieldPulse — Salesman Location & Expense Tracker

Mobile-first field salesman tracker with live browser GPS location punching, daily travel & allowance ledger (`Place`, `Departure`, `Arrival`, `Fare`, `DA`, `Conveyance`, `Night Stay`, `Total`), live running balance tracking, out-of-pocket reimbursement claims, monthly charts, and separate **Salesman** and **Admin** dashboards backed by **Supabase PostgreSQL**.

## Database Setup (Supabase)

1. Create a project in [Supabase](https://supabase.com).
2. Copy the **Connection String (URI)** from **Project Settings → Database → Connection string** (prefer the **Session Pooler** URI for IPv4 compatibility on Render).
3. Set `DATABASE_URL` in `.env` (locally) or Render Environment Variables.
   - The server automatically applies [`supabase/schema.sql`](supabase/schema.sql) on startup, or you can run it directly in the Supabase SQL Editor.

## Local Development

```bash
cp .env.example .env
# Set DATABASE_URL in .env
npm install
npm run dev
```

On first launch with an empty database, open the app and complete the **First-Time Admin Setup** screen to create your Head Office Admin ID and PIN, then add salesmen from the Admin dashboard.

## Deploy on Render

1. Push this repository to GitHub.
2. On [Render](https://render.com), choose **New → Blueprint** (uses [`render.yaml`](render.yaml)) or **New → Web Service**:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`
3. Add environment variable `DATABASE_URL` with your Supabase PostgreSQL URI (`AUTH_SECRET` auto-generates with Blueprint).
4. Render automatically serves the app over HTTPS, allowing mobile browsers to grant Geolocation access for live GPS punches.

