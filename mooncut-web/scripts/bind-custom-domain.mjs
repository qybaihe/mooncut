#!/usr/bin/env node
/**
 * Bind mooncut.me (+ www) DNS for Cloudflare Pages.
 *
 * Requires an API Token with:
 *   - Zone.DNS:Edit
 *   - Zone:Read
 * for zone mooncut.me
 *
 * Usage:
 *   export CLOUDFLARE_API_TOKEN=...
 *   node scripts/bind-custom-domain.mjs
 *
 * Optional:
 *   CF_ZONE_ID=... CF_PAGES_TARGET=mooncut.pages.dev node scripts/bind-custom-domain.mjs
 */

const token = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN
if (!token) {
  console.error('Missing CLOUDFLARE_API_TOKEN (Zone.DNS Edit + Zone Read)')
  process.exit(1)
}

const zoneId = process.env.CF_ZONE_ID || 'ae3645540d481bede20f58942539568b'
const target = (process.env.CF_PAGES_TARGET || 'mooncut.pages.dev').replace(/\.$/, '')
const names = (process.env.CF_DOMAIN_NAMES || 'mooncut.me,www.mooncut.me').split(',').map((s) => s.trim()).filter(Boolean)

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
}

async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!json.success) {
    const msg = (json.errors || []).map((e) => e.message).join('; ') || res.statusText
    throw new Error(`${method} ${path} failed: ${msg}`)
  }
  return json.result
}

async function upsertCname(name) {
  const list = await cf('GET', `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(name)}`)
  const existing = Array.isArray(list) ? list[0] : null
  const payload = {
    type: 'CNAME',
    name,
    content: target,
    ttl: 1,
    proxied: true,
    comment: 'MoonCut Pages production',
  }
  if (existing?.id) {
    console.log(`update CNAME ${name} -> ${target} (${existing.id})`)
    return cf('PUT', `/zones/${zoneId}/dns_records/${existing.id}`, payload)
  }
  console.log(`create CNAME ${name} -> ${target}`)
  return cf('POST', `/zones/${zoneId}/dns_records`, payload)
}

const main = async () => {
  for (const name of names) {
    const rec = await upsertCname(name)
    console.log('ok', rec.name, rec.type, rec.content, 'proxied=', rec.proxied)
  }
  console.log('\nNext: wait 1–3 minutes for Pages domain status=active, then open https://mooncut.me/')
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
