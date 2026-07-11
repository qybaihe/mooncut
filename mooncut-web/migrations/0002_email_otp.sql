-- Email OTP for Resend verification (register / login)
CREATE TABLE IF NOT EXISTS email_otps (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS email_otps_email_created_idx ON email_otps(email, created_at);
CREATE INDEX IF NOT EXISTS email_otps_expires_at_idx ON email_otps(expires_at);
