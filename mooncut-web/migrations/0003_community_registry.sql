-- Cloudflare Pages-native capability community.
-- Packages are deliberately limited to small declarative assets: manifest,
-- SKILL.md and connector metadata. No uploaded executable code is stored or run.
CREATE TABLE IF NOT EXISTS community_packages (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  owner_user_id TEXT NOT NULL,
  publisher_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS community_releases (
  id TEXT PRIMARY KEY NOT NULL,
  package_id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'yanked')),
  manifest_json TEXT NOT NULL,
  skill_markdown TEXT NOT NULL,
  connector_json TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  skill_sha256 TEXT NOT NULL,
  connector_sha256 TEXT NOT NULL,
  published_at TEXT NOT NULL,
  FOREIGN KEY (package_id) REFERENCES community_packages(id) ON DELETE CASCADE,
  UNIQUE(package_id, version)
);

CREATE INDEX IF NOT EXISTS community_releases_public_idx
  ON community_releases(status, published_at DESC);
CREATE INDEX IF NOT EXISTS community_packages_owner_idx
  ON community_packages(owner_user_id, created_at DESC);
