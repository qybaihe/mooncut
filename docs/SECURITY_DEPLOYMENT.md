# MoonCut Security Deployment Baseline

This repository never stores operational credentials. Keep local `.env` files ignored and owner-only (`chmod 600 .env`); rotate any credential that was ever copied into an untrusted location.

## Public render Agent

An Agent that can be reached through a Tunnel or network listener must set all of the following. Startup fails closed when `MOONCUT_PUBLIC_DEPLOYMENT=true` (or a non-loopback host) does not meet this baseline:

```dotenv
MOONCUT_PUBLIC_DEPLOYMENT=true
MOONCUT_EDGE_AUTH_ONLY=true
MOONCUT_COOKIE_SECURE=true
MOONCUT_API_KEY=<long random service key>
MOONCUT_PUBLIC_BASE_URL=https://mooncut.me
MOONCUT_MAIL_DOWNLOAD_SECRET=<separate long random secret>
MOONCUT_CAPABILITY_SIGNING_KEY=<separate long random secret>
MOONCUT_ALLOW_INPUT_PATH=false
```

Browser traffic must go through Pages. The tunnel is service-to-service only, and Pages supplies the service key plus the authenticated user identity. Render-completion emails are always sent to that authenticated user, never a request-provided address.

## Required deployment checks

1. Apply all D1 migrations, including `0003_auth_rate_limits.sql`.
2. Store Pages/Agent secrets in the deployment secret manager, never `wrangler.toml` or Git.
3. Verify the public health endpoint returns only liveness data; it must not expose gateway or model configuration.
4. Pin the deployed Agent artifact to a Git SHA and record it in the deployment log. Do not deploy an Agent mode not represented by the pushed source.
5. Keep outbound browser tools behind network egress controls. The source rejects loopback, private, link-local, credential-bearing, HTTP, and non-standard-port URLs; infrastructure egress controls remain the protection against DNS rebinding.

## Repository policy

Enable GitHub branch protection before production use. Require the security and build workflows on pull requests, restrict deploy credentials to the production deployment job, and keep release write permissions out of build jobs.
