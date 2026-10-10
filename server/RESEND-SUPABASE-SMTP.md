# Supabase Auth mail delivery with Resend

The project's Supabase Auth SMTP integration is configured with the verified `dewclient.fun` sender domain. No Resend key is stored in this repository or in the client/server `.env`.

Current values:

- Host: `smtp.resend.com`
- Port: `465` (implicit TLS)
- Username: `resend`
- From address: `no-reply@dewclient.fun`
- Sender name: `DewClient`
- Email auto-confirm: disabled, so signup verification remains required

The SMTP password is stored in Supabase Auth's protected project configuration. To replace it, create a sending API key in Resend and update only the SMTP password in Supabase Dashboard → Authentication → Emails → SMTP Settings. Do not copy the key into this repository, the launcher, or Discord.

Resend requires the sending domain to be verified; keep its SPF/DKIM DNS records active. Supabase recommends configuring SPF, DKIM, and DMARC and keeping Auth email separate from marketing mail.
