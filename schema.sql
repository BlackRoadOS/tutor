CREATE TABLE IF NOT EXISTS solves (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  preview TEXT NOT NULL,
  full_answer TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0,
  stripe_checkout_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_solves_paid ON solves(paid);
CREATE INDEX IF NOT EXISTS idx_solves_checkout_session ON solves(stripe_checkout_session_id);
