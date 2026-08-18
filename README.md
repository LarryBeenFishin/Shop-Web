# Shop-Web — Auto Repair Website + Appointments

This is the reusable version of the Toro-style auto repair website. It keeps the customer-facing website and appointment workflow, but replaces the Google appointment backend with **Supabase** and appointment emails with **Resend**.

## What is included

- Responsive auto repair website
- Two-step appointment form
- No same-day appointments
- Weekends disabled
- Live booked-time availability from Supabase
- Duplicate-slot protection at the database level
- Customer confirmation email through Resend
- Shop notification email through Resend
- `/admin` appointment dashboard
- Appointment status: Pending / Confirmed / Completed / Cancelled
- Central `config.js` so each new shop can be rebranded without rebuilding the site
- Placeholder shop images that can be swapped for the customer's real photos

## 1. Drag these files into GitHub

Upload the **contents** of this folder to the root of the `Shop-Web` repository. Do not upload the outer `Shop-Web-Ready` folder itself.

## 2. Create the Supabase project

1. Create a new Supabase project.
2. Open **SQL Editor**.
3. Copy everything from `supabase/schema.sql` and run it.
4. In Supabase project settings, copy:
   - Project URL
   - Service role key

The service-role key is only used inside Vercel server functions. Never put it in `config.js` or public HTML.

## 3. Set up Resend

1. Create/verify the shop's sending domain in Resend.
2. Create a Resend API key.
3. Pick the address that should receive new appointment notifications.

## 4. Add Vercel environment variables

In Vercel → Project → Settings → Environment Variables, add every value listed in `.env.example`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `SHOP_NOTIFICATION_EMAIL`
- `SHOP_NAME`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

For `ADMIN_SESSION_SECRET`, use a long random value.

## 5. Customize the new customer

Edit only `config.js` for most shop-specific information:

- shop name
- phone
- address
- hours
- colors
- services
- specials
- reviews
- trust stats
- appointment slots

Replace these images with the new customer's real photos while keeping the same filenames if you want zero HTML changes:

- `assets/hero-placeholder.svg`
- `assets/shop-1.svg`
- `assets/shop-2.svg`

You can replace them with JPG/PNG/WebP files too; if the filename changes, update the matching path in `index.html`.

## 6. Admin dashboard

After deployment, open:

`https://YOUR-DOMAIN.com/admin`

Sign in with the `ADMIN_PASSWORD` environment variable. The dashboard shows upcoming requests and lets the shop update their status.

## Important difference from Toro's live site

This package does **not** include the old Google Apps Script backend, invoicing, inspections, texting, customer database, or Shop Pilot features. It is intentionally the reusable **website + appointment** product.
