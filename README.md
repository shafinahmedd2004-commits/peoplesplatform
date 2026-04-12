# People Platform — Fixed v2

## What was fixed

### SQL Schema (001_initial_schema.sql)
- Added missing `post_interests` table (caused interest button 500 errors)
- Added `IF NOT EXISTS` to all CREATE statements (safe to re-run)
- Added missing RLS policies for `sections`, `reviews`, `post_interests`, `conversations`, `conversation_participants`
- Fixed `handle_new_auth_user` trigger to copy phone for OTP users

### Frontend (index.html)
- Placeholder Supabase credentials now clearly marked — replace lines 559-560
- Google OAuth new users now correctly go through onboarding instead of skipping it
- `onAuthStateChange` no longer double-fires on email login
- `loadBookings()` now called on app boot — bookings page no longer empty
- Tag search now strips `#` prefix so clicking `#tag` works correctly
- Chat realtime channel no longer kills the notification channel (two separate channels)
- `submitBooking()` no longer hardcodes `S.allUsers[0]` — resolves provider from active conversation or post context
- Post cards now have working Book and Connect buttons with correct provider context
- Discover cards now have working Book and Connect buttons
- Admin page no longer crashes for non-admin users
- Removed broken `liked` state and fake like counter (likes were never persisted)
- `calcCompletionPct` now runs against the full saved profile, not the partial update object

### AI Function (supabase/functions/ai/index.ts)
- All Groq calls wrapped in try/catch — no more unhandled promise rejections
- `safeParseJSON` strips markdown code fences before parsing — fixes JSON parse errors
- Title suggest falls back to line-split if JSON parse fails
- Empty body no longer crashes the function
- Moderation has fast rule-based pre-check to avoid unnecessary API calls

### API Function (supabase/functions/api/index.ts)
- Upstash Redis URL encoding fixed — values with special chars no longer break path-style requests
- `expressInterest` now records in `post_interests` table with upsert (prevents duplicate counts)
- `calcCompletionPct` runs against full profile row after update (not partial update object)

### Webhooks Function (supabase/functions/webhooks/index.ts)
- Stripe JSON parse wrapped in try/catch
- Cron secret guard extracted to shared function
- `boost_expires_at` set to null when expiring boosts (not just `is_boosted = false`)
- Weekly insights loop has per-user try/catch so one failure doesn't stop the batch

## Deployment steps

1. Supabase Dashboard → SQL Editor → paste `supabase/migrations/001_initial_schema.sql` → Run All
2. Authentication → Providers → enable Email + Google OAuth + Phone
3. Storage → New bucket → name it `media` → set to Public
4. Edge Functions → deploy `api`, `ai`, `webhooks` via Dashboard editor
   - `webhooks` must be deployed with `--no-verify-jwt`
5. Edge Functions → Manage Secrets → add all secrets (see below)
6. **Edit `index.html` lines 559-560** — replace `SUPABASE_URL` and `SUPABASE_ANON_KEY`
7. Push to GitHub → import to Vercel → done
8. Database → Replication → enable for: messages, notifications, connections, bookings

## Secrets required in Supabase Dashboard → Edge Functions → Manage Secrets

```
GROQ_API_KEY              from console.groq.com (free)
UPSTASH_REDIS_REST_URL    from upstash.com (free tier)
UPSTASH_REDIS_REST_TOKEN  from upstash.com (free tier)
STRIPE_SECRET_KEY         from dashboard.stripe.com
STRIPE_WEBHOOK_SECRET     from Stripe → Webhooks
SENDGRID_API_KEY          from sendgrid.com (100 free/day)
CRON_SECRET               any random string you choose
```

SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are injected automatically — do not add them.

## cron-job.org setup (free)

Create two jobs at https://cron-job.org:

| URL | Schedule | Header |
|-----|----------|--------|
| `https://YOUR_PROJECT.supabase.co/functions/v1/webhooks/cron/expire-boosts` | Every hour | `x-cron-secret: YOUR_CRON_SECRET` |
| `https://YOUR_PROJECT.supabase.co/functions/v1/webhooks/cron/weekly-insights` | Every Sunday 9pm | `x-cron-secret: YOUR_CRON_SECRET` |
