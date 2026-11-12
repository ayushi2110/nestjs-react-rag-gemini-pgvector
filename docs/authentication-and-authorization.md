# Authentication and authorization

## Trust boundaries

- `POST /api/chat` remains public and keeps returning grounded answers and
  document source snippets as before. This means public chat can reveal
  document-derived information; admin-only controls secure direct management
  and document-reading endpoints, not facts shared by the RAG assistant.
- There is one administrator and no public registration or signup.
- Every document list, detail, statistics, ingest, upload, and delete endpoint
  requires both a valid access token and the ADMIN role. Frontend route
  protection is only a usability layer; the backend guards are authoritative.

## Admin credentials

Generate separate random secrets of at least 32 characters for
`AUTH_JWT_SECRET` and `AUTH_CSRF_SECRET`, for example with
`openssl rand -base64 48`. Set `ADMIN_BOOTSTRAP_EMAIL` and
`ADMIN_BOOTSTRAP_PASSWORD` only in the backend environment while provisioning.
The password must be 12-128 characters and is stored only as an Argon2id hash.

After applying the schema migration, run the explicit seed command from
`backend/`:

```bash
npm run seed:admin
```

It refuses to overwrite an existing admin. The database uses a singleton
primary-key/check constraint so concurrent or direct attempts to insert a
second admin also fail. There is no public password reset or account creation
route. Remove the bootstrap credentials from the environment after seeding.
Never commit `.env` files or print credentials in logs.

## Database migration

There was no migration runner before admin authentication. The additive,
idempotent schema is in `database/migrations/001_admin_auth.sql`.
Docker Compose mounts it into PostgreSQL's initialization directory for a new
database volume. The existing `database/init.sql` still initializes the RAG
schema.

For an already initialized database volume, apply the migration once from the
repository root:

```bash
docker compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < database/migrations/001_admin_auth.sql
```

Do not delete the PostgreSQL volume to apply this migration; the script is
additive and safe to rerun.

To run the live singleton-constraint integration test, set `TEST_DATABASE_URL`
to a disposable PostgreSQL test database before running `npm test` in `backend/`.
The test creates and drops a uniquely named temporary schema.

## Sessions and tokens

- Login verifies the supplied password with Argon2id and returns a generic
  `401` on invalid credentials.
- The access JWT expires after 10 minutes by default (maximum configurable
  lifetime: one hour). It is returned in JSON and held only in frontend memory;
  protected requests use a bearer header.
- Refresh tokens are opaque 256-bit random values. Only SHA-256 hashes are
  stored in `admin_refresh_tokens`; previous hashes remain recorded until
  session cleanup so reuse can be detected.
- Refresh rotates tokens inside a database transaction. A consumed token
  replay revokes its whole session. Refresh sessions have a seven-day absolute
  lifetime by default (maximum configurable lifetime: 30 days).
- The JWT strategy checks the session and admin in PostgreSQL for each
  protected request. Logout revokes the current session, invalidating both its
  refresh token and any still-unexpired access tokens.
- Multiple browser/device sessions for this one admin are supported. Logout
  revokes the current browser session.

## Cookies and CSRF

The API sets `__Host-refresh` and `__Host-csrf` cookies, both HttpOnly, Secure,
host-only, and Path `/`. The CSRF value is a signed,
time-limited double-submit token. Login, refresh, and logout require the value
in both the CSRF cookie and `X-CSRF-Token` header. Tokens are obtained through
`GET /api/auth/csrf`, including during session restoration.

For unrelated frontend/API domains, set `AUTH_COOKIE_SAME_SITE=none`,
`AUTH_COOKIE_SECURE=true`, and configure `FRONTEND_ORIGINS` with the exact
frontend origin(s), without wildcards. Serve both sites over HTTPS. The browser
must allow credentialed cross-site cookies; some privacy settings block
third-party cookies, so test the production browser topology. Same-site reverse
proxying is more reliable where available. Localhost is treated specially by
modern browsers for Secure cookies; otherwise use HTTPS locally.

## Rate limiting and logging

The login endpoint is limited to five attempts per minute per source IP by the
Nest throttler. Its default store is in-memory and per API process; deployments
with multiple replicas should configure a shared throttler store. Authentication
logs must never include passwords, authorization headers, refresh tokens, or
CSRF tokens.

## Admin API summary

| Route | Access |
| --- | --- |
| `GET /api/auth/csrf` | Public CSRF bootstrap |
| `POST /api/auth/login` | Public, CSRF protected, rate limited |
| `POST /api/auth/refresh` | Refresh cookie + CSRF header |
| `POST /api/auth/logout` | Refresh cookie + CSRF header |
| `GET /api/auth/me` | Admin bearer token |
| `GET /api/documents` | Admin bearer token |
| `GET /api/documents/:documentId` | Admin bearer token |
| `GET /api/documents/stats` | Admin bearer token |
| `POST /api/documents/ingest` | Admin bearer token |
| `POST /api/documents/upload` | Admin bearer token |
| `DELETE /api/documents/:documentId` | Admin bearer token |

`401 Unauthorized` indicates missing/invalid/expired/revoked authentication;
`403 Forbidden` indicates a failed CSRF or role check.
