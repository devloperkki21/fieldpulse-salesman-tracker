# FieldPulse — Salesman Location & Expense Tracker

Mobile-first field salesman tracker with live browser GPS location punching, daily travel & allowance ledger (`Place`, `Departure`, `Arrival`, `Fare`, `DA`, `Conveyance`, `Night Stay`, `Total`), live running balance tracking, out-of-pocket reimbursement claims, monthly charts, and separate **Salesman** and **Admin** dashboards backed by **Supabase PostgreSQL**.

## Database Setup (Supabase)

- All tables live in an isolated **`fieldpulse`** PostgreSQL schema (`fieldpulse.users`, `fieldpulse.location_punches`, `fieldpulse.expenses`, `fieldpulse.advances`, `fieldpulse.reimbursement_claims`) defined in [`supabase/schema.sql`](supabase/schema.sql).
- On startup, the server automatically ensures the `fieldpulse` schema, tables, and indexes exist.
- Set `DATABASE_URL` using your Supabase **Connection String (URI)** from **Project Settings → Database → Connection string** (or the **Connect** button → **Session pooler**):
  ```text
  postgresql://postgres.<project-ref>:<your-db-password>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres
  ```

## Local Development

```bash
cp .env.example .env
# Add your Supabase DB password to DATABASE_URL in .env
npm install
npm run dev
```

On first launch with an empty database, open the app and complete the **First-Time Admin Setup** screen to create your Head Office Admin ID and PIN, then add salesmen from the Admin dashboard.

## Deploy on Render

1. Connect this GitHub repository on [Render](https://dashboard.render.com/blueprints) (**New → Blueprint**, uses [`render.yaml`](render.yaml)) or **New → Web Service**:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`
2. Add environment variable `DATABASE_URL` with your Supabase PostgreSQL Pooler URI (`AUTH_SECRET` auto-generates via Blueprint).
3. Render serves the app over HTTPS automatically, enabling mobile browser Geolocation permission for live GPS punches.
