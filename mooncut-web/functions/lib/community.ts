import { AuthHttpError, json, type EdgeUser, type Env } from './auth'

type RecordValue = Record<string, unknown>

export type CommunityPackage = {
  slug: string
  publisher: { id: string; label: string; trust: 'community' }
  display: { name: string; tagline: string; category: string }
  kinds: string[]
  permissions: Array<{ name: string; reason: string }>
  release: {
    version: string
    publishedAt: string
    files: { package: string; manifest: string; skill: string; connector: string }
    integrity: { manifestSha256: string; skillSha256: string; connectorSha256: string; packageSha256: string }
  }
}

type ReleaseRow = {
  id: string
  slug: string
  owner_user_id: string
  publisher_name: string
  version: string
  status: 'published' | 'yanked'
  manifest_json: string
  skill_markdown: string
  connector_json: string
  manifest_sha256: string
  skill_sha256: string
  connector_sha256: string
  published_at: string
}

const MAX_SKILL_BYTES = 200 * 1024
const MAX_JSON_BYTES = 64 * 1024
const slugPattern = /^[a-z0-9][a-z0-9-]{2,79}$/u
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const allowedAdapters = new Set(['fifa-highlights'])

const record = (value: unknown, message: string): RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthHttpError(400, 'INVALID_PACKAGE', message)
  return value as RecordValue
}

const text = (value: unknown, label: string, max: number) => {
  if (typeof value !== 'string') throw new AuthHttpError(400, 'INVALID_PACKAGE', `${label} 必须是文本`)
  const clean = value.trim()
  if (!clean || clean.length > max || /[\u0000]/u.test(clean)) throw new AuthHttpError(400, 'INVALID_PACKAGE', `${label} 内容无效或过长`)
  return clean
}

const plainText = (value: unknown, label: string, max: number) => {
  const clean = text(value, label, max)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(clean)) throw new AuthHttpError(400, 'INVALID_PACKAGE', `${label} 包含不支持的控制字符`)
  return clean
}

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const randomId = () => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const filePaths = (slug: string, version: string) => {
  const base = `/api/v1/community/packages/${encodeURIComponent(slug)}/${encodeURIComponent(version)}`
  return {
    package: `${base}/package.mooncut-capability.json`,
    manifest: `${base}/manifest.json`,
    skill: `${base}/SKILL.md`,
    connector: `${base}/connector.json`,
  }
}

const validateManifest = (value: unknown, slug: string, version: string) => {
  const manifest = record(value, 'manifest.json 必须是 JSON 对象')
  if (manifest.schemaVersion !== 'mooncut.capability.v1') throw new AuthHttpError(400, 'INVALID_MANIFEST', '仅支持 mooncut.capability.v1')
  if (manifest.kind !== 'hosted-cli' && manifest.kind !== 'skill-only') throw new AuthHttpError(400, 'INVALID_MANIFEST', '仅支持受控 Connector 或纯 Skill 能力包')
  if (manifest.kind === 'hosted-cli' && (typeof manifest.adapter !== 'string' || !allowedAdapters.has(manifest.adapter))) {
    throw new AuthHttpError(400, 'UNSUPPORTED_ADAPTER', 'Connector 必须引用 MoonCut 内置且已审核的 adapter')
  }
  if (manifest.kind === 'skill-only' && manifest.adapter !== undefined) throw new AuthHttpError(400, 'INVALID_MANIFEST', '纯 Skill 能力包不能声明 adapter')
  if (text(manifest.version, 'manifest.version', 64) !== version) throw new AuthHttpError(400, 'VERSION_MISMATCH', '表单版本必须与 manifest.version 一致')
  const display = record(manifest.display, 'manifest.display 缺失')
  const compatibility = record(manifest.compatibility, 'manifest.compatibility 缺失')
  const permissions = manifest.permissions
  const tools = manifest.tools
  const guidance = record(manifest.guidance, 'manifest.guidance 缺失')
  const name = plainText(display.name, '能力包名称', 80)
  const tagline = plainText(display.tagline, '能力包简介', 180)
  const category = plainText(display.category, '能力包分类', 60)
  if (typeof compatibility.agent !== 'string' || !Array.isArray(compatibility.tasks) || !compatibility.tasks.length) throw new AuthHttpError(400, 'INVALID_MANIFEST', 'manifest.compatibility 不完整')
  if (!Array.isArray(permissions) || permissions.length > 4 || !Array.isArray(tools) || !tools.length || tools.length > 8) throw new AuthHttpError(400, 'INVALID_MANIFEST', '权限或工具数量不符合限制')
  if (typeof guidance.whenToUse !== 'string' || typeof guidance.evidenceRule !== 'string' || !Array.isArray(guidance.neverDo)) throw new AuthHttpError(400, 'INVALID_MANIFEST', 'manifest.guidance 不完整')
  for (const permissionValue of permissions) {
    const permission = record(permissionValue, '权限格式无效')
    if ((permission.name !== 'network' && permission.name !== 'artifact.write') || typeof permission.reason !== 'string') throw new AuthHttpError(400, 'INVALID_MANIFEST', '权限不在允许范围内')
  }
  for (const toolValue of tools) {
    const tool = record(toolValue, '工具格式无效')
    if (typeof tool.name !== 'string' || typeof tool.description !== 'string' || (tool.confirmation !== 'never' && tool.confirmation !== 'when_artifact_is_created')) throw new AuthHttpError(400, 'INVALID_MANIFEST', '工具声明不完整')
  }
  return {
    manifest,
    display: { name, tagline, category },
    permissions: permissions.map((permissionValue) => {
      const permission = permissionValue as RecordValue
      return { name: String(permission.name), reason: String(permission.reason).trim() }
    }),
    kinds: manifest.kind === 'hosted-cli' ? ['skill', 'connector'] : ['skill'],
    slug,
  }
}

const validateConnector = (value: unknown, manifest: RecordValue) => {
  const connector = record(value, 'connector.json 必须是 JSON 对象')
  const security = record(connector.security, 'connector.security 缺失')
  if (
    connector.schemaVersion !== 'mooncut.connector.v1' ||
    connector.mode !== 'builtin-adapter-reference' ||
    security.neverExecutePackageCode !== true ||
    security.requiresLocalAdapter !== true
  ) {
    throw new AuthHttpError(400, 'UNSAFE_CONNECTOR', 'Connector 必须是禁止执行下载代码的内置 adapter 引用')
  }
  if (manifest.kind === 'skill-only') {
    if (connector.adapter !== undefined) throw new AuthHttpError(400, 'INVALID_CONNECTOR', '纯 Skill Connector 不能声明 adapter')
    return connector
  }
  if (connector.adapter !== manifest.adapter || typeof connector.adapter !== 'string' || !allowedAdapters.has(connector.adapter)) {
    throw new AuthHttpError(400, 'UNSUPPORTED_ADAPTER', 'Connector 与 manifest 的内置 adapter 不匹配')
  }
  return connector
}

const packageBundle = (item: CommunityPackage) => JSON.stringify({
  format: 'mooncut-community-capability',
  formatVersion: 1,
  publisher: item.publisher,
  release: { slug: item.slug, version: item.release.version },
  manifest: item.release.files.manifest,
  skill: item.release.files.skill,
  connector: item.release.files.connector,
  install: { mode: 'builtin-adapter-reference', neverExecuteDownloadedCode: true },
  integrity: {
    skillSha256: item.release.integrity.skillSha256,
    connectorSha256: item.release.integrity.connectorSha256,
  },
})

const toPackage = async (row: ReleaseRow): Promise<CommunityPackage> => {
  const manifest = JSON.parse(row.manifest_json) as RecordValue
  const display = record(manifest.display, '保存的 manifest 无效')
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : []
  const paths = filePaths(row.slug, row.version)
  // Derive integrity from the exact bytes we are about to download/connect.
  // This also makes a stale metadata row fail closed at the Agent boundary.
  const [manifestSha256, skillSha256, connectorSha256] = await Promise.all([
    sha256(row.manifest_json), sha256(row.skill_markdown), sha256(row.connector_json),
  ])
  const item: CommunityPackage = {
    slug: row.slug,
    publisher: { id: `user:${row.owner_user_id.slice(0, 12)}`, label: row.publisher_name, trust: 'community' },
    display: { name: String(display.name), tagline: String(display.tagline), category: String(display.category) },
    kinds: manifest.kind === 'hosted-cli' ? ['skill', 'connector'] : ['skill'],
    permissions: permissions.flatMap((permission) => {
      if (!permission || typeof permission !== 'object') return []
      const source = permission as RecordValue
      return typeof source.name === 'string' && typeof source.reason === 'string' ? [{ name: source.name, reason: source.reason }] : []
    }),
    release: {
      version: row.version,
      publishedAt: row.published_at,
      files: paths,
      integrity: {
        manifestSha256,
        skillSha256,
        connectorSha256,
        packageSha256: '',
      },
    },
  }
  item.release.integrity.packageSha256 = await sha256(packageBundle(item))
  return item
}

const latestQuery = `
  SELECT r.id, p.slug, p.owner_user_id, p.publisher_name, r.version, r.status,
    r.manifest_json, r.skill_markdown, r.connector_json, r.manifest_sha256,
    r.skill_sha256, r.connector_sha256, r.published_at
  FROM community_releases r
  JOIN community_packages p ON p.id = r.package_id
`

const getRelease = async (env: Env, slug: string, version?: string) => {
  if (!slugPattern.test(slug)) throw new AuthHttpError(404, 'PACKAGE_NOT_FOUND', '能力包不存在')
  const statement = version
    ? `${latestQuery} WHERE p.slug = ? AND r.version = ? AND r.status = 'published' LIMIT 1`
    : `${latestQuery} WHERE p.slug = ? AND r.status = 'published' ORDER BY r.published_at DESC LIMIT 1`
  const values = version ? [slug, version] : [slug]
  const row = await env.DB.prepare(statement).bind(...values).first<ReleaseRow>()
  if (!row) throw new AuthHttpError(404, 'PACKAGE_NOT_FOUND', '能力包不存在或已下架')
  return row
}

const download = (body: string, contentType: string, filename: string) =>
  new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/gu, '-') }"`,
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  })

export const listCommunityPackages = async (env: Env, query?: string) => {
  const raw = (query || '').trim().slice(0, 80).toLocaleLowerCase()
  const result = await env.DB.prepare(`${latestQuery} WHERE r.status = 'published' ORDER BY r.published_at DESC LIMIT 100`).all<ReleaseRow>()
  const items = await Promise.all((result.results || []).map(toPackage))
  const latestBySlug = new Set<string>()
  return items.filter((item) => {
    if (latestBySlug.has(item.slug)) return false
    latestBySlug.add(item.slug)
    return !raw || [item.slug, item.display.name, item.display.tagline, item.display.category, item.publisher.label].join(' ').toLocaleLowerCase().includes(raw)
  })
}

export const uploadCommunityPackage = async (request: Request, env: Env, user: EdgeUser) => {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) throw new AuthHttpError(415, 'MULTIPART_REQUIRED', '请以表单方式上传 manifest、SKILL.md 与 connector')
  const form = await request.formData()
  const slug = plainText(form.get('slug'), 'slug', 80).toLowerCase()
  const version = plainText(form.get('version'), 'version', 64)
  const publisherName = plainText(form.get('publisherName') || user.email.split('@', 1)[0], '发布者名称', 48)
  if (!slugPattern.test(slug) || !versionPattern.test(version)) throw new AuthHttpError(400, 'INVALID_PACKAGE', 'slug 或版本号格式不正确')

  const readFile = async (name: string, maximum: number) => {
    const file = form.get(name)
    if (!(file instanceof File)) throw new AuthHttpError(400, 'MISSING_FILE', `缺少 ${name} 文件`)
    if (file.size < 1 || file.size > maximum) throw new AuthHttpError(413, 'PACKAGE_TOO_LARGE', `${name} 文件大小不符合限制`)
    return await file.text()
  }
  const [manifestText, skillText, connectorText] = await Promise.all([
    readFile('manifest', MAX_JSON_BYTES), readFile('skill', MAX_SKILL_BYTES), readFile('connector', MAX_JSON_BYTES),
  ])
  const skill = plainText(skillText, 'SKILL.md', MAX_SKILL_BYTES)
  let manifestValue: unknown
  let connectorValue: unknown
  try {
    manifestValue = JSON.parse(manifestText)
    connectorValue = JSON.parse(connectorText)
  } catch {
    throw new AuthHttpError(400, 'INVALID_JSON', 'manifest.json 或 connector.json 不是有效 JSON')
  }
  const checked = validateManifest(manifestValue, slug, version)
  validateConnector(connectorValue, checked.manifest)
  const [manifestSha256, skillSha256, connectorSha256] = await Promise.all([sha256(manifestText), sha256(skill), sha256(connectorText)])
  const existing = await env.DB.prepare('SELECT id, owner_user_id FROM community_packages WHERE slug = ?').bind(slug).first<{ id: string; owner_user_id: string }>()
  if (existing && existing.owner_user_id !== user.id) throw new AuthHttpError(409, 'SLUG_TAKEN', '这个 slug 已被其他创作者使用')
  const packageId = existing?.id || randomId()
  const now = new Date().toISOString()
  if (!existing) {
    await env.DB.prepare('INSERT INTO community_packages (id, slug, owner_user_id, publisher_name, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(packageId, slug, user.id, publisherName, now).run()
  } else {
    await env.DB.prepare('UPDATE community_packages SET publisher_name = ? WHERE id = ?').bind(publisherName, packageId).run()
  }
  const releaseId = randomId()
  try {
    await env.DB.prepare(`INSERT INTO community_releases (
      id, package_id, version, status, manifest_json, skill_markdown, connector_json,
      manifest_sha256, skill_sha256, connector_sha256, published_at
    ) VALUES (?, ?, ?, 'published', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(releaseId, packageId, version, manifestText, skill, connectorText, manifestSha256, skillSha256, connectorSha256, now).run()
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/unique|constraint/iu.test(message)) throw new AuthHttpError(409, 'VERSION_EXISTS', '这个版本已经发布；请提高版本号')
    throw error
  }
  const row = await getRelease(env, slug, version)
  return await toPackage(row)
}

export const handleCommunityRequest = async (request: Request, env: Env, pathname: string, user: EdgeUser | null) => {
  const url = new URL(request.url)
  if (request.method === 'GET' && pathname === '/v1/community/packages') {
    return json({ items: await listCommunityPackages(env, url.searchParams.get('query') || undefined) })
  }
  if (request.method === 'POST' && pathname === '/v1/community/packages') {
    if (!user) return json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401)
    return json({ item: await uploadCommunityPackage(request, env, user) }, 201)
  }
  const assetMatch = pathname.match(/^\/v1\/community\/packages\/([a-z0-9-]{3,80})\/([^/]+)\/(manifest\.json|SKILL\.md|connector\.json|package\.mooncut-capability\.json)$/u)
  if (request.method === 'GET' && assetMatch) {
    const [, slug, version, file] = assetMatch
    const row = await getRelease(env, slug, version)
    if (file === 'manifest.json') return download(row.manifest_json, 'application/json; charset=utf-8', `${slug}-${version}-manifest.json`)
    if (file === 'SKILL.md') return download(row.skill_markdown, 'text/markdown; charset=utf-8', `${slug}-${version}-SKILL.md`)
    if (file === 'connector.json') return download(row.connector_json, 'application/json; charset=utf-8', `${slug}-${version}-connector.json`)
    const item = await toPackage(row)
    return download(packageBundle(item), 'application/json; charset=utf-8', `${slug}-${version}.mooncut-capability.json`)
  }
  const detailMatch = pathname.match(/^\/v1\/community\/packages\/([a-z0-9-]{3,80})$/u)
  if (request.method === 'GET' && detailMatch) return json({ item: await toPackage(await getRelease(env, detailMatch[1])) })
  return null
}

export const communityReleaseForConnect = async (env: Env, slug: string) => {
  const row = await getRelease(env, slug)
  const [skillSha256, connectorSha256] = await Promise.all([sha256(row.skill_markdown), sha256(row.connector_json)])
  return {
    slug: row.slug,
    version: row.version,
    manifest: row.manifest_json,
    skill: row.skill_markdown,
    connector: row.connector_json,
    integrity: { skillSha256, connectorSha256 },
  }
}
