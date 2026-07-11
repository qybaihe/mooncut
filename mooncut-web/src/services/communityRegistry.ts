export type CommunityRegistryPackage = {
  slug: string
  publisher: { id: string; label: string; trust: 'official' | 'verified' }
  display: { name: string; tagline: string; category: string }
  kinds: string[]
  permissions: Array<{ name: string; reason: string }>
  release: {
    version: string
    publishedAt: string
    files: { package: string; manifest: string; skill: string; connector: string }
    integrity: { manifestSha256: string; packageSha256: string }
  }
}

type CommunityRegistryCatalog = {
  schemaVersion: number
  registry: string
  mode: 'public-read-only'
  packages: CommunityRegistryPackage[]
}

const configuredBaseUrl = import.meta.env.VITE_MOONCUT_COMMUNITY_REGISTRY_URL || 'https://mc.classby.cn'
const registryBaseUrl = configuredBaseUrl.replace(/\/$/, '')

export function registryAssetUrl(path: string) {
  if (!path.startsWith('/registry/')) throw new Error('注册表返回了无效资源路径')
  return `${registryBaseUrl}${path}`
}

export async function getCommunityRegistry(): Promise<CommunityRegistryCatalog> {
  const response = await fetch(registryAssetUrl('/registry/v1/catalog.json'), { headers: { Accept: 'application/json' } })
  const body = await response.json() as unknown
  if (!response.ok) throw new Error(`注册表请求失败（${response.status}）`)
  if (!body || typeof body !== 'object' || !Array.isArray((body as CommunityRegistryCatalog).packages)) throw new Error('注册表返回格式不正确')
  return body as CommunityRegistryCatalog
}
