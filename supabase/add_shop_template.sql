-- Copy this file into Supabase SQL Editor for each new repair shop.
-- Replace every example value before running.

with new_shop as (
  insert into public.shops (
    slug,
    name,
    timezone,
    status,
    notification_email,
    resend_from_email,
    twilio_phone_number,
    public_config
  ) values (
    'smith-auto',
    'Smith Auto Care',
    'America/Chicago',
    'active',
    'service@smithauto.com',
    'Smith Auto Care <appointments@smithauto.com>',
    null,
    jsonb_build_object(
      'tagline', 'Honest Auto Repair Without the Runaround',
      'subtagline', 'From routine maintenance to major repairs — we keep your vehicle safe, reliable, and ready for the road.',
      'phoneDisplay', '(847) 555-1234',
      'phoneDial', '8475551234',
      'email', 'service@smithauto.com',
      'address', '123 Main St, Crystal Lake, IL 60014',
      'mapQuery', '123 Main St, Crystal Lake, IL 60014',
      'hoursShort', 'Mon-Fri: 8AM-6PM',
      'hoursHtml', 'Monday–Friday: 8:00 AM – 6:00 PM<br>Saturday: Closed<br>Sunday: Closed',
      'city', 'Crystal Lake',
      'state', 'IL',
      'websiteUrl', 'https://smithauto.com',
      'colors', jsonb_build_object(
        'primary', '#163051',
        'accent', '#af2727'
      )
    )
  )
  returning id
)
insert into public.shop_domains (shop_id, hostname, is_primary)
select id, 'smithauto.com', true from new_shop;
