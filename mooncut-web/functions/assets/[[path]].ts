/**
 * Serve /assets/* through a Function so we can:
 * 1) Always set correct JS/CSS MIME + CORS for module scripts (they send Origin)
 * 2) Bypass edge cache entries that poisoned hashed JS URLs with SPA HTML
 * 3) If a missing hash would SPA-fallback to HTML, fall back to the current main bundle
 */

type PagesEnv = {
  ASSETS: Fetcher
}

const isProbablyHtml = (body: string, contentType: string | null) => {
  if (contentType?.includes('text/html')) return true
  const head = body.slice(0, 64).trimStart().toLowerCase()
  return head.startsWith('<!doctype') || head.startsWith('<html')
}

/** Resolve the main bundle from this exact deployment, never a stale hard-coded hash. */
const currentMainBundle = async (assets: Fetcher, origin: string) => {
  const index = await assets.fetch(new Request(new URL('/index.html', origin), {
    headers: { Accept: 'text/html' },
  }))
  if (!index.ok) return null
  const html = await index.text()
  const match = html.match(/<script[^>]+\bsrc=["'](\/assets\/index-[^"']+\.js)["']/iu)
  return match?.[1] ?? null
}

const withAssetHeaders = (response: Response, pathname: string) => {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('X-Content-Type-Options', 'nosniff')
  if (pathname.endsWith('.js')) {
    headers.set('Content-Type', 'application/javascript; charset=utf-8')
  } else if (pathname.endsWith('.css')) {
    headers.set('Content-Type', 'text/css; charset=utf-8')
  } else if (pathname.endsWith('.png')) {
    headers.set('Content-Type', 'image/png')
  } else if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) {
    headers.set('Content-Type', 'image/jpeg')
  } else if (pathname.endsWith('.svg')) {
    headers.set('Content-Type', 'image/svg+xml')
  } else if (pathname.endsWith('.webp')) {
    headers.set('Content-Type', 'image/webp')
  }
  // Avoid multi-year immutable caching of wrong bodies after deploy races.
  headers.set('Cache-Control', 'public, max-age=300, must-revalidate')
  headers.delete('CDN-Cache-Control')
  headers.delete('Cloudflare-CDN-Cache-Control')
  return headers
}

export const onRequestGet: PagesFunction<PagesEnv> = async (context) => {
  const url = new URL(context.request.url)
  const pathname = url.pathname

  // Never let the SPA HTML fallback leak out as a module script.
  let assetResponse = await context.env.ASSETS.fetch(context.request)

  if (pathname.endsWith('.js') || pathname.endsWith('.css')) {
    const clone = assetResponse.clone()
    const text = await clone.text()
    if (isProbablyHtml(text, assetResponse.headers.get('content-type'))) {
      const currentMain = pathname.endsWith('.js') ? await currentMainBundle(context.env.ASSETS, url.origin) : null
      if (currentMain && pathname !== currentMain) {
        const fallbackUrl = new URL(currentMain, url.origin)
        assetResponse = await context.env.ASSETS.fetch(new Request(fallbackUrl.toString(), context.request))
        const fbText = await assetResponse.clone().text()
        if (isProbablyHtml(fbText, assetResponse.headers.get('content-type'))) {
          return new Response('/* MoonCut asset missing after deploy */\n', {
            status: 503,
            headers: {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*',
            },
          })
        }
      } else {
        return new Response('/* MoonCut refused to serve HTML as an asset */\n', {
          status: 503,
          headers: {
            'Content-Type': pathname.endsWith('.css')
              ? 'text/css; charset=utf-8'
              : 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
          },
        })
      }
    }
  }

  const headers = withAssetHeaders(assetResponse, pathname)
  headers.set('X-MoonCut-Asset-Proxy', '1')
  return new Response(assetResponse.body, {
    status: assetResponse.status,
    headers,
  })
}

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
      'Cache-Control': 'no-store',
    },
  })
