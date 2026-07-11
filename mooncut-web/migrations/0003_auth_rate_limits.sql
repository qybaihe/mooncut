-- Privacy-preserving source rate limits for transactional OTP email.
-- client_key is SHA-256 of a source identifier, never a raw IP address.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  id TEXT PRIMARY KEY NOT NULL,
  action TEXT NOT NULL,
  client_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_action_client_created_idx
  ON auth_rate_limits(action, client_key, created_at);
