-- Account-centre commercial model. Payment providers update entitlements through
-- their server-side webhook; browser actions never grant a paid plan directly.
CREATE TABLE IF NOT EXISTS billing_accounts (
  user_id TEXT PRIMARY KEY NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free', 'creator', 'pro')),
  subscription_status TEXT NOT NULL DEFAULT 'free' CHECK(subscription_status IN ('free', 'active', 'canceling', 'past_due')),
  period_started_at TEXT NOT NULL,
  period_ends_at TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK(cancel_at_period_end IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS billing_generation_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL CHECK(plan IN ('free', 'creator', 'pro')),
  estimated_minutes INTEGER NOT NULL CHECK(estimated_minutes > 0),
  state TEXT NOT NULL CHECK(state IN ('reserved', 'processing', 'consumed', 'released')),
  job_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS billing_generation_reservations_user_state_idx
  ON billing_generation_reservations(user_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('video_generation', 'smart_minutes', 'creative_points')),
  quantity INTEGER NOT NULL CHECK(quantity >= 0),
  job_id TEXT,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS billing_usage_events_user_type_idx
  ON billing_usage_events(user_id, event_type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS billing_usage_events_job_type_idx
  ON billing_usage_events(job_id, event_type) WHERE job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_checkout_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  requested_plan TEXT NOT NULL CHECK(requested_plan IN ('creator', 'pro')),
  status TEXT NOT NULL CHECK(status IN ('pending_setup', 'ready_for_payment', 'paid', 'expired', 'cancelled')),
  provider_reference TEXT,
  checkout_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS billing_checkout_requests_user_idx
  ON billing_checkout_requests(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS billing_checkout_requests_provider_reference_idx
  ON billing_checkout_requests(provider_reference) WHERE provider_reference IS NOT NULL;
