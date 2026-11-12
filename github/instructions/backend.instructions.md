# Backend instructions

Applies to `backend/src/**/*.ts`.

## Architecture

- Use the existing NestJS modules: `chat`, `documents`, `gemini`, and `common`.
- Use `auth` services/guards for identity and authorization; keep the public
  chat endpoint separate from admin-only document-management endpoints.
- Keep route handling in controllers, application logic in services, and request
  validation in DTOs using `class-validator`.
- Register providers in their module and inject services or the shared
  `DATABASE_POOL`; do not create ad hoc PostgreSQL pools.
- Load configuration through the globally registered `ConfigService`. Use
  `getOrThrow` for required settings and preserve existing defaults for optional
  settings.
- The database stores one row per document chunk in `documents`. Keep
  embeddings at 768 dimensions to match `VECTOR(768)` and the embedding
  generation configuration.

## API and persistence

- The API global prefix is `/api`; controller paths are relative to it.
- Keep request/response behavior consistent with `instructions/architecture.md`
  and `frontend/API_CONTRACT.md`.
- Use parameterized SQL for values. JSONB metadata filters are currently built
  from validated key names and parameterized values; preserve that safety.
- Treat multi-row document ingestion as an atomic operation: begin a transaction,
  commit only after all chunks are stored, roll back on failure, and always
  release the client.
- Keep chunking and embedding calls in their existing services rather than
  duplicating them in controllers.

## Validation and errors

- DTOs define accepted request fields. The global validation pipe rejects
  unknown fields, transforms values, and enforces DTO constraints.
- Use Nest HTTP exceptions for client errors such as invalid input, unsupported
  file types, and failed file extraction. Do not silently convert failures
  into successful responses.
- Preserve the configured upload constraints: multipart field `file`, accepted
  PDF/DOCX/TXT/Markdown MIME types, and 20 MB maximum.
- Protect every direct document read, statistics, ingest, upload, and delete
  route with both JWT authentication and the ADMIN role guard. Do not rely on
  frontend routing for authorization.
- Keep admin provisioning offline/operator-only. Never add a public signup,
  return password hashes, store refresh tokens unhashed, or log bearer/cookie
  tokens.
- Preserve refresh rotation, CSRF checks, and session revocation when changing
  authentication code. Access-token validation checks the database session so
  logout invalidates that session immediately.
- Log operational context with Nest's `Logger`; do not log API keys or other
  secrets.
- Preserve CORS and route behavior unless the task explicitly changes them.

## Verification

From `backend/`, use `npm run build` for compilation and `npm test` for auth,
service, cookie, and protected-document tests. `npm run lint` runs ESLint with
`--fix`, so be aware that it may modify files; ESLint is not currently listed as
a backend dependency.
