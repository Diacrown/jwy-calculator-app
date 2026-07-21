SETUP STEPS — Email quote directly from the app
==============================================================

One-time setup, then the "Email quote to..." box in the Quotes section
works from then on.

STEP 1 — Create a free Resend account
------------------------------------------------------------
1. Go to resend.com and sign up (free tier: 3,000 emails/month, 100/day
   -- almost certainly enough for a quoting tool).
2. In the Resend dashboard, go to API Keys -> Create API Key. Copy it
   somewhere safe -- you won't be able to see it again.

STEP 2 — Add the API key to Netlify
------------------------------------------------------------
1. Netlify dashboard -> your site -> Project configuration ->
   Environment variables -> Add a variable.
2. Key: RESEND_API_KEY
   Value: (paste the key from Step 1)
3. Save, then trigger a new deploy so the function picks it up.

STEP 3 — Sender address (works immediately, no extra setup)
------------------------------------------------------------
By default, emails send from "JWY Calculator <onboarding@resend.dev>" --
this works immediately with zero configuration, no domain verification
needed. It's fine for testing and light use.

If you want emails to instead come from your own domain (e.g.
quotes@worldshiner.com), that requires verifying your domain with
Resend (adding a few DNS records they give you) -- optional, do this
later if/when it matters. Once verified, set a second environment
variable:
   Key: RESEND_FROM_ADDRESS
   Value: JWY Calculator <quotes@yourdomain.com>

STEP 4 — Test it
------------------------------------------------------------
1. Fill out a quote in the app.
2. In the Quotes section, find "Email quote to..." on the right side.
3. Type a real email address you can check, pick full/price-only,
   click Send.
4. Check that inbox (and spam folder, since onboarding@resend.dev is a
   shared test domain and may land there on the first few sends).

NOTES
------------------------------------------------------------
- If RESEND_API_KEY isn't set yet, clicking Send will show a clear
  error ("RESEND_API_KEY is not configured") rather than failing
  silently or breaking anything else in the app.
- This is separate from the existing Print/Preview buttons -- those
  still work exactly as before regardless of whether email is set up.
