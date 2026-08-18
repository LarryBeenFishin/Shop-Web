# Shop-Web — Multi-Shop Auto Repair Platform

Shop-Web is the reusable auto-repair website/admin system based on the Toro workflow. It is now structured as a **multi-shop platform** instead of a single website that gets copied and modified for every customer.

## Architecture

The recommended setup is:

- **One GitHub repo** — this repository
- **One shared Supabase project** — stores all shops and operational data
- **One Vercel project per repair shop** — each deployment points at the same repo
- **One `SHOP_SLUG` per Vercel project** — identifies which shop that deployment belongs to

Every operational record is tenant-scoped by `shop_id`:

- appointments
- customers
- inspections
- SMS history
- push-notification subscriptions
- audit events

The API resolves the active shop first and then applies that `shop_id` to every read/write. This is the core security boundary between shops.

## Included features

### Customer website
- Responsive repair-shop website
- Two-step appointment request flow
- Live appointment availability
- Duplicate-slot protection
- Customer + shop email notifications through Resend
- Automatic customer-profile sync

### Admin
- Calendar
- Today + upcoming appointments
- Create/edit/reschedule appointments
- Status workflow
- Internal notes
- Customer profiles
- Inspection builder
- Inspection history
- Customer-facing inspection reports
- SMS conversation history + outbound texting through Twilio
- Browser push notifications
- Audit trail in Supabase

## Database setup

For a brand-new Supabase project run these files in order:

1. `supabase/schema.sql`
2. `supabase/admin_features.sql`
3. `supabase/multi_tenant_v2.sql`

`multi_tenant_v2.sql` creates the `shops` tenant table, attaches `shop_id` to all operational tables, migrates existing data into the first shop, creates tenant-aware indexes, and adds the audit log.

## Vercel environment variables

Shared across deployments:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `VAPID_SUBJECT` (when push is enabled)
- `VAPID_PUBLIC_KEY` (when push is enabled)
- `VAPID_PRIVATE_KEY` (when push is enabled)

Set separately for each shop's Vercel project:

- `SHOP_SLUG` — e.g. `smith-auto`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `TWILIO_ACCOUNT_SID` (if that shop uses Twilio)
- `TWILIO_AUTH_TOKEN` (if that shop uses Twilio)
- `TWILIO_PHONE_NUMBER` (fallback if not stored on the shop row)
- `TWILIO_VALIDATE_WEBHOOKS=true` once the Twilio webhook is configured

Legacy fallbacks still supported:

- `SHOP_NAME`
- `SHOP_NOTIFICATION_EMAIL`
- `RESEND_FROM_EMAIL`

For new shops, store those settings on the `shops` row instead.

## Shop-specific website config

Each row in `public.shops` has a `public_config` JSON object.

During every Vercel build, `scripts/build-config.js` reads the shop identified by `SHOP_SLUG`, merges its `public_config` onto the repository's generic `config.js`, and generates the deployed shop-specific `config.js`.

That means **the source repo stays generic**. Shop A and Shop B can deploy from the same branch while getting different names, phone numbers, services, hours, colors, reviews, appointment slots, etc.

Vercel's `buildCommand` runs the generator automatically.

## Adding another repair shop

See `docs/NEW_SHOP_CHECKLIST.md`.

At a high level:

1. Add a row to `public.shops` with a unique slug and its `public_config`.
2. Optionally add its domain to `public.shop_domains`.
3. Create another Vercel project from this same GitHub repository.
4. Add the shared Supabase environment variables.
5. Set that Vercel project's `SHOP_SLUG` to the new shop slug.
6. Set a unique `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET`.
7. Add the custom domain.
8. Configure Resend/Twilio/push only if that shop needs them.
9. Deploy.

No database copy and no backend code copy are required.

## Important security rules

- Never expose `SUPABASE_SERVICE_ROLE_KEY` in browser code.
- Admin session cookies are HTTP-only and now include the tenant/shop identity.
- Never make an API query against an operational table without applying the shop scope.
- Twilio webhook signature validation can be enabled with `TWILIO_VALIDATE_WEBHOOKS=true`.
- Row Level Security remains enabled on tenant tables; server functions use the Supabase secret/service key and enforce tenant scope in application code.

## Current tenant

The migration seeds the current deployment as:

`shop-web`

For the current Vercel project, set:

`SHOP_SLUG=shop-web`

before onboarding a second active shop.
