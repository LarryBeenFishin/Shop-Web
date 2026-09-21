# Account Recovery and Customer Notifications

## One-time database setup

Run `supabase/account_recovery_and_marketing.sql` in the Supabase SQL Editor after the existing platform-owner and technician portal migrations.

## Vercel environment variables

Email delivery:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` — for example `Toros Auto Care <notifications@updates.yourdomain.com>`

Verify the sender domain in Resend before using it in production. The Resend onboarding sender is only suitable for limited testing.

Text delivery:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER` — E.164 format, for example `+18475551234`
- `TWILIO_VALIDATE_WEBHOOKS=true` in production

Security:

- `MARKETING_UNSUBSCRIBE_SECRET` — a long random value. If omitted, the admin or platform session secret is used as a fallback.

## Shop setup

1. In `/platform`, add a recovery email to every shop administrator.
2. In the shop’s **Settings** page, add the owner notification email and a recovery email for every technician.
3. In Twilio, point the number’s incoming-message webhook to `https://YOUR-DOMAIN/api/incoming-sms` using `POST`.
4. Book a test appointment with an email address and with **Text my appointment confirmation** selected.
5. Test **Forgot password?** on both `/admin` and `/tech`.
6. Open **Promotions** and verify the email and text subscriber counts before sending a test campaign.

## Consent behavior

- Appointment email confirmations are transactional and are sent when a customer provides an email address.
- Appointment text confirmations are sent only when the customer selects the appointment-text checkbox.
- Promotional email and promotional text consent are separate checkboxes.
- Marketing emails include an unsubscribe link.
- Incoming `STOP`, `UNSUBSCRIBE`, `CANCEL`, `END`, or `QUIT` messages remove text-marketing consent. `START`, `UNSTOP`, or `YES` restores it.
- Unsubscribing from promotions does not stop operational appointment or service communication.
