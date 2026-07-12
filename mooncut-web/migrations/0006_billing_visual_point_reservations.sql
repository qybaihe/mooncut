-- AI visual generation is capped at two images per edit job. Reserve its
-- maximum eight creative points before the job enters the local Agent so a
-- concurrent job cannot spend past the user's plan limit.
ALTER TABLE billing_generation_reservations
  ADD COLUMN reserved_creative_points INTEGER NOT NULL DEFAULT 0 CHECK(reserved_creative_points >= 0);
