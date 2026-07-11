# Security policy

## Reporting a vulnerability

Do not create a public issue for a suspected vulnerability and do not include
credentials, private media, or exploit payloads in any public channel.

Use GitHub's private vulnerability-reporting flow for
[`qybaihe/mooncut`](https://github.com/qybaihe/mooncut/security/advisories/new).
If that flow is unavailable, contact the repository owner privately through
GitHub and include a minimal reproduction, affected commit, impact, and a safe
way to reproduce the issue.

## Supported baseline

Only the current `main` branch and the latest published Studio/iOS preview
artifacts receive security fixes. Do not deploy development defaults on a
public interface: configure real API keys, a unique capability signing key,
HTTPS, secure cookies, upload limits, and explicit CORS origins.

## Response goals

Maintainers should acknowledge a credible report within seven days, provide a
status update within thirty days, and coordinate disclosure after a fix or
mitigation is available.
