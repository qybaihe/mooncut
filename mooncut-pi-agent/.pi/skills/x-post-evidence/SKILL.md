---
name: x-post-evidence
description: Find and capture a trustworthy original X post for a product launch, announcement, person, company, or event, then use the untouched native screenshot as a video evidence asset.
---

# X Post Evidence

Use the `capture_x_post` tool when a talking-head claim refers to an announcement that is best supported by an original X post.

## Source policy

- Prefer the organization's official account over an executive's account.
- Always pass an explicit `trustedAccounts` allowlist.
- For an organization claim, pass its `officialDomains` when available.
- Use compact source-language search terms, for example `GPT-5.6 rolling out`, not translated event words.
- Prefer original root posts over replies, quotes, and reposts.
- Never recreate, translate, recolor, or crop the post into a fake card.
- Capture only public posts; do not bypass login or protected-account controls.

## Handoff to the edit spec

The tool returns an `evidenceAsset.id`. Create an `evidence` beat and set its `evidenceId` to that ID. Keep the source URL and trust result in the job artifacts.

If more than one candidate is plausible or source validation fails, do not claim the screenshot is official.
