CREATE TABLE IF NOT EXISTS admin_accounts (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'ADMIN' CHECK (role = 'ADMIN'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id         UUID PRIMARY KEY,
  admin_id   SMALLINT NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_sessions_admin_id_idx
  ON admin_sessions (admin_id);

CREATE TABLE IF NOT EXISTS admin_refresh_tokens (
  id          BIGSERIAL PRIMARY KEY,
  session_id  UUID NOT NULL REFERENCES admin_sessions(id) ON DELETE CASCADE,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS admin_refresh_tokens_session_id_idx
  ON admin_refresh_tokens (session_id);
