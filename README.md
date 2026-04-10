# People Platform

A multi-role people connection and marketplace platform for emerging markets. Built on Supabase (Edge Functions, Auth, Realtime, Storage) with a vanilla HTML/JS frontend deployed on Vercel.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + JS (single file) — Vercel |
| Auth | Supabase Auth (email, Google OAuth, phone OTP) |
| Database | Supabase Postgres |
| Backend | Supabase Edge Functions (Deno) |
| Realtime | Supabase Realtime (chat, notifications) |
| Storage | Supabase Storage (media uploads) |
| Cache | Upstash Redis (HTTP) |
| AI | Groq API (Llama 3.1) |
| Cron | cron-job.org (free) |

## Repo structure

```
people-platform/
├── index.html                          # Full frontend SPA
├── README.md
├── .gitignore
├── supabase/
│   ├── config.toml                     # Local dev config
│   ├── migrations/
│   │   └── 001_initial_schema.sql      # Full DB schema — run this first
│   └── functions/
│       ├── api/
│       │   └── index.ts               # Main API (all routes)
│       ├── ai/
│       │   └── index.ts               # AI features (Groq)
│       └── webhooks/
│           └── index.ts               # Stripe + cron (no JWT)
```

## Deployment (dashboard only — no CLI needed)

See `DEPLOYMENT_GUIDE.md` for the full step-by-step dashboard walkthrough.

**Quick summary:**
1. Create Supabase project (Singapore region)
2. Run `supabase/migrations/001_initial_schema.sql` in SQL Editor
3. Enable Realtime on: messages, notifications, connections, bookings
4. Authentication → enable Email + Google OAuth
5. Storage → create bucket named `media` (public)
6. Edge Functions → deploy `api`, `ai`, `webhooks` via dashboard editor
7. Edge Functions → Manage secrets → add Groq, Upstash, Stripe, SendGrid, CRON_SECRET
8. Update `index.html` lines 350-351 with your Supabase URL + anon key
9. Push to GitHub → import to Vercel → done

## Environment secrets (set in Supabase dashboard)

```
GROQ_API_KEY              # console.groq.com — free
UPSTASH_REDIS_REST_URL    # upstash.com — free tier
UPSTASH_REDIS_REST_TOKEN  # upstash.com — free tier
STRIPE_SECRET_KEY         # dashboard.stripe.com
STRIPE_WEBHOOK_SECRET     # Stripe → Webhooks
SENDGRID_API_KEY          # sendgrid.com — free 100/day
CRON_SECRET               # any random string you choose
```

> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — do not add them manually.

## Monthly cost at MVP

~$3–6/month total. Everything runs on free tiers until ~5,000 active users.

## Platform modules

- Idea Hub — startup pitches and co-founder matching
- Services — freelance skill marketplace
- Jobs — gig and full-time listings
- Farmers Market — agricultural produce listings
- Mentorship — 1:1 session booking
- Learning — tutoring and courses
- Investors — deal flow and pitches
- Events — local meetups

## User roles

Investor · Founder · Freelancer · Farmer · Student · Service Provider · Mentor

Multi-role supported — one user can hold multiple roles simultaneously.
