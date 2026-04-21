# The People Platform

A full-stack people-connection web app. Frontend hosted on GitHub Pages. Backend runs on Supabase Edge Functions.

---

## Files in this repo

| File | Where it goes |
|------|--------------|
| `index.html` | GitHub Pages (this repo) |
| `.nojekyll` | GitHub Pages (this repo) — prevents Jekyll from breaking the app |
| `api_index.ts` | Supabase Edge Function named **`super-handler`** |
| `ai_index.ts` | Supabase Edge Function named **`ai`** |

---

## Deploy Steps

### 1 — GitHub Pages (frontend)
1. Push `index.html` and `.nojekyll` to the **root** of your `main` branch.
2. Go to **Settings → Pages → Source → Deploy from branch → main / root**.
3. Your app will be live at `https://<your-username>.github.io/<repo-name>/`.

### 2 — Supabase Edge Functions (backend)

Install the Supabase CLI if you haven't:
```bash
npm install -g supabase
supabase login
```

Deploy the API function:
```bash
# Rename api_index.ts → index.ts, then:
supabase functions deploy super-handler --project-ref jeblkkurrdfpgilrubxt
```

Deploy the AI function:
```bash
# Rename ai_index.ts → index.ts, then:
supabase functions deploy ai --project-ref jeblkkurrdfpgilrubxt
```

Or paste the file contents directly in **Supabase Dashboard → Edge Functions → [function name] → Code tab → Deploy**.

### 3 — Environment variables (Supabase Dashboard → Edge Functions → Secrets)

| Secret | Where to find it |
|--------|-----------------|
| `SUPABASE_URL` | Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → service_role |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) → API Keys |

---

## Quick checklist before going live
- [ ] `SUPABASE_URL` in `index.html` matches your project
- [ ] `SUPABASE_ANON_KEY` in `index.html` matches your project
- [ ] `API_BASE` in `index.html` matches your deployed `super-handler` function URL
- [ ] `AI_BASE` in `index.html` matches your deployed `ai` function URL
- [ ] All 4 secrets set in Supabase Edge Functions → Secrets
- [ ] Google OAuth redirect URL set to your GitHub Pages URL in Supabase Auth → URL Configuration
