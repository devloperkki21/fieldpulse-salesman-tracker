# FieldPulse — Salesman Location & Expense Tracker

Mobile-first field salesman tracker with live browser GPS location punching, daily travel & allowance ledger (`Place`, `Departure`, `Arrival`, `Fare`, `DA`, `Conveyance`, `Night Stay`, `Total`), live running balance tracking, out-of-pocket reimbursement claims, monthly charts, and separate **Salesman** and **Admin** dashboards backed by **Supabase**.

## Database Setup (Supabase API — No DB Password Needed)

- All tables use the `fp_*` prefix (`fp_users`, `fp_location_punches`, `fp_expenses`, `fp_advances`, `fp_reimbursement_claims`) with Row Level Security enabled in [`supabase/schema.sql`](supabase/schema.sql).
- The backend connects over HTTPS using `@supabase/supabase-js` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (no PostgreSQL database password required).

## Local Development

```bash
cp .env.example .env
# Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
npm install
npm run dev
```

On first launch with an empty database, open the app and complete the **First-Time Admin Setup** screen to create your Head Office Admin ID and PIN, then add salesmen from the Admin dashboard.

## Deploy on Render

1. Connect this GitHub repository on [Render](https://dashboard.render.com/blueprints) (**New → Blueprint**, uses [`render.yaml`](render.yaml)) or **New → Web Service**:
   - **Build Command:** `npm install --include=dev && npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`
2. Add environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (`AUTH_SECRET` auto-generates via Blueprint).
3. Render serves the app over HTTPS automatically, enabling mobile browser Geolocation permission for live GPS punches.
