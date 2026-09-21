# New Shop Checklist

Use this every time a new repair shop is added to Shop-Web.

Before adding shops, run `supabase/account_recovery_and_marketing.sql` once after the platform-owner and technician migrations. It adds recovery emails, secure reset tokens, appointment text consent, marketing consent, and campaign history.

## 1. Create the tenant in the owner portal

Open `/platform`, select **Add shop**, and enter the shop details, first domain, and first administrator account. The portal creates the required tenant records without exposing the Supabase service key.

In `public.shops`, add a row with:

- `slug` — lowercase, URL-safe, unique (example: `smith-auto`)
- `name` — customer-facing shop name
- `timezone`
- `status` — `active`
- `notification_email` — where appointment emails should go
- `resend_from_email` — optional shop-specific sender
- `twilio_phone_number` — optional E.164 number, such as `+18475551234`
- `public_config` — website configuration JSON

The `public_config` uses the same shape as `config.js`. It can contain only overrides; the build generator deep-merges it onto the generic template.

Example:

```json
{
  "tagline": "Honest Auto Repair Without the Runaround",
  "phoneDisplay": "(847) 555-1234",
  "phoneDial": "8475551234",
  "email": "service@smithauto.com",
  "address": "123 Main St, Crystal Lake, IL 60014",
  "mapQuery": "123 Main St, Crystal Lake, IL 60014",
  "hoursShort": "Mon-Fri: 8AM-6PM",
  "hoursHtml": "Monday–Friday: 8:00 AM – 6:00 PM<br>Saturday: Closed<br>Sunday: Closed",
  "city": "Crystal Lake",
  "state": "IL",
  "websiteUrl": "https://smithauto.com",
  "colors": {
    "primary": "#163051",
    "accent": "#af2727"
  }
}
```

The shop name comes from the `name` column and automatically overrides the generic `config.js` name.

## 2. Confirm the domain mapping

After you know the production hostname/custom domain, confirm it in the shop's **Domains** section in `/platform`:

- `shop_id` = the new shop's ID
- `hostname` = domain without `https://`, path, port, or `www.`
- `is_primary` = true for the main domain

`SHOP_SLUG` is still the primary tenant selector for separate Vercel projects. Domain mapping is a useful fallback and prepares the platform for shared-host deployments later.

## 3. Create a Vercel project

Import the **same `Shop-Web` GitHub repository** into a new Vercel project.

Do not create a new GitHub repo just for the customer.

## 4. Add environment variables

Copy shared platform values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` — a sender on a verified Resend domain
- `MARKETING_UNSUBSCRIBE_SECRET` — a long random value (the admin session secret is used as a fallback)
- VAPID keys if push notifications are enabled

Create new per-shop values:

- `SHOP_SLUG=<the slug from Supabase>`
- `ADMIN_PASSWORD=<shop admin password>`
- `ADMIN_SESSION_SECRET=<new long random string>`

`ADMIN_PASSWORD` is a legacy fallback. The preferred login is the administrator username and password created in `/platform`.

If using Twilio, add the correct credentials/number for that shop deployment.

## 5. Deploy

Vercel runs `scripts/build-config.js` during the build.

The script:

1. Reads `SHOP_SLUG`.
2. Loads that shop from Supabase.
3. Merges its `public_config` with the generic template.
4. Generates the deployed `config.js`.

The GitHub source remains generic.

## 6. Test tenant isolation

Before handing the site to the customer, test:

- Website name/phone/address/hours are for the correct shop.
- Appointment appears only in that shop's `/admin`.
- Customer profile appears only for that shop.
- Same appointment time can be used by a different shop.
- Inspection links load from the correct shop domain.
- Text history does not show another shop's conversations.
- Push notifications go only to subscriptions for that shop.

## 7. Optional integrations

### Resend
Set `notification_email` and `resend_from_email` on the shop row. Keep the Resend API key in Vercel, never in Supabase public config.

### Twilio
Store the shop's sending number on `shops.twilio_phone_number` or use `TWILIO_PHONE_NUMBER` as a per-deployment fallback. Configure the inbound webhook to:

`https://SHOP-DOMAIN/api/incoming-sms`

Once confirmed, set `TWILIO_VALIDATE_WEBHOOKS=true`.

### Push
Use the shared VAPID keypair. Push subscriptions are stored with `shop_id`, so one shop cannot receive another shop's notifications.

## 8. Transfer an existing shop

Before importing anything, make a read-only export or backup of the old system. Then open the shop in `/platform` and use the **Safe migration center**:

1. Export customers, appointments, and inspections as separate CSV or JSON files.
2. Upload one file and choose the matching data type.
3. Run **Preview import** and review invalid rows and duplicates.
4. Confirm the import only when the preview is correct.
5. Open the shop admin and verify customer totals, calendar dates/times, and inspection history.
6. Import the next data type and repeat the verification.
7. Mark the transfer **Completed** only after the old and new totals match.

If a committed file was wrong, use **Roll back** on that batch. The rollback uses recorded database IDs and does not broadly delete records by name or date.

## Rule for future development

Any new table that contains customer/shop business data should include `shop_id` and every API query must scope by it. Do not add an unscoped operational query to a shared tenant table.
