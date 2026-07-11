# Edge auth + video tunnel (+ delivery)

## Goal

| Concern | Owner |
|---|---|
| Website | Cloudflare Pages |
| Register / login / session | Cloudflare D1 + Pages Functions |
| 口播助手 / 陪练 | Cloudflare → env 配置的上游 API |
| Video edit only | Local agent via Tunnel |
| 成片交付 | **本机**剪完后 `agently-cli` **自动发邮件**（附件 MP4）到 `notificationEmail` |
| Browser never talks to Tunnel | Pages Function injects service key |

## Request flow

```
Browser (https://mooncut.me)
  ├─ GET/POST /api/v1/auth/*     → D1 (no tunnel)
  ├─ GET /api/v1/models          → edge stub
  └─ /api/v1/edits|edit-jobs|assets|render-queue
         → Function checks mooncut_session cookie (D1)
         → fetch(AGENT_ORIGIN + path, {
              Authorization: Bearer AGENT_INTERNAL_KEY,
              X-MoonCut-User-Id, X-MoonCut-User-Email
            })
         → local agent (MOONCUT_EDGE_AUTH_ONLY=true)
```

## Secrets (Pages production)

| Secret | Meaning |
|---|---|
| `AGENT_ORIGIN` | Tunnel public base, e.g. `https://xxx.trycloudflare.com` |
| `AGENT_INTERNAL_KEY` | Same as local `MOONCUT_API_KEY` |
| `RESEND_API_KEY` | Resend API key for email OTP (`re_…`) |

| Var | Meaning |
|---|---|
| `RESEND_FROM` | From header, e.g. `MoonCut <noreply@mooncut.me>` (domain must be verified in Resend) |

```bash
printf '%s' 'https://YOUR-TUNNEL' | npx wrangler pages secret put AGENT_ORIGIN --project-name mooncut
printf '%s' 'YOUR-LONG-KEY' | npx wrangler pages secret put AGENT_INTERNAL_KEY --project-name mooncut
printf '%s' 're_YOUR_KEY' | npx wrangler pages secret put RESEND_API_KEY --project-name mooncut
```

### Auth OTP flow

```
POST /api/v1/auth/otp/send   { email, purpose: "register" | "login" }
POST /api/v1/auth/otp/verify { email, code, purpose, password? }  # password required for register
POST /api/v1/auth/login      { email, password }                   # password fallback still works
```

- Codes: 6 digits, 10 min TTL, 60s resend cooldown, max 5 attempts
- Stored as SHA-256 hashes in D1 `email_otps`
- Register without OTP is rejected (`OTP_REQUIRED`)
- OTP send responses do not disclose whether an email is registered; D1 also
  applies a hashed-source limit (20 send attempts / 15 min) in addition to the
  per-email limit. Apply migration `0003_auth_rate_limits.sql` before deploy.

## Local agent

```bash
# mooncut-pi-agent/.env
MOONCUT_API_KEY=<same as AGENT_INTERNAL_KEY>
MOONCUT_EDGE_AUTH_ONLY=true
MOONCUT_COOKIE_SECURE=true
MOONCUT_PUBLIC_DEPLOYMENT=true
MOONCUT_PUBLIC_BASE_URL=https://mooncut.me
MOONCUT_MAIL_DOWNLOAD_SECRET=<separate-long-random-secret>
MOONCUT_CAPABILITY_SIGNING_KEY=<separate-long-random-secret>
```

## D1

```bash
npx wrangler d1 migrations apply mooncut --remote
```

Database: `mooncut` (`6fbf1aa4-cc17-42a8-9123-58910af44a12`), binding `DB`.

## Deploy

```bash
cd mooncut-web
# keep functions/ at project root
npx wrangler pages deploy dist --project-name mooncut --commit-dirty=true
```

## Not in Phase 1

- Assistant / community / capability market full implementation on edge
- Job metadata exclusively in D1 (still polled from agent)
- Finished video storage on R2

## Phase 2 delivery path

1. User logs in on Cloudflare (D1).
2. User uploads a talking-head clip; Agent always derives `notificationEmail` from the authenticated account, ignoring any client-supplied recipient.
3. Only `/v1/edits|assets|edit-jobs/*` hit the tunnel.
4. Local agent finishes Remotion cut → attaches `final.mp4` → auto-sends email via `agently-cli`.

### Local agent env

```bash
MOONCUT_EDGE_AUTH_ONLY=true
MOONCUT_PUBLIC_DEPLOYMENT=true
MOONCUT_COOKIE_SECURE=true
MOONCUT_API_KEY=<same as AGENT_INTERNAL_KEY>
MOONCUT_MAIL_DOWNLOAD_SECRET=<separate-long-random-secret>
MOONCUT_MAIL_TRANSPORT=agently-cli
MOONCUT_MAIL_AUTO_SEND=true
MOONCUT_MAIL_ATTACH_VIDEO=true
# MOONCUT_MAIL_CLI=/opt/homebrew/bin/agently-cli
```

### Cloudflare secrets / vars for assistants

```bash
# Secrets
npx wrangler pages secret put ASSISTANT_SCRIPT_API_KEY --project-name mooncut
npx wrangler pages secret put ASSISTANT_COACH_API_KEY --project-name mooncut

# Plaintext vars (Dashboard → Settings → Environment variables)
# ASSISTANT_SCRIPT_URL=https://api.openai.com/v1/chat/completions
# ASSISTANT_SCRIPT_MODEL=gpt-4o-mini
# ASSISTANT_COACH_URL=...
# ASSISTANT_COACH_MODEL=...
# MODELS_JSON={"available":["gpt-4o-mini"],...}
```
