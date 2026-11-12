# Testing and verification instructions

## Current test coverage

The backend has Jest tests for admin login, refresh rotation/reuse, logout,
provisioning uniqueness handling, CSRF/cookie behavior, JWT expiry, and guarded
document uploads. These tests use service/controller doubles; the PostgreSQL
singleton constraint has a live-database integration test when `TEST_DATABASE_URL`
is set; it is skipped otherwise.
The frontend has no test runner or application test files. Tests under
`node_modules` belong to dependencies and are not project tests.

## Before changing code

- For backend changes, build from `backend/` with `npm run build`.
- Run backend auth and authorization tests with `npm test` from `backend/`.
- For frontend changes, run `npm run build` from `frontend/`; this runs
  TypeScript project checks and the Vite production build.
- Run the relevant ESLint command when needed. Note that `backend`'s
  `npm run lint` includes `--fix` and may modify files; frontend's lint script
  does not specify auto-fix.
- For database, API, or full-stack behavior, use the relevant local services
  and exercise the documented endpoint(s) from `instructions/architecture.md`.
  The backend requires `DATABASE_URL` and `GEMINI_API_KEY`; the database
  container is started with Docker Compose from the repository root.

## Writing tests

If adding tests, introduce only the runner and scripts required for the chosen
test scope, and place tests alongside the behavior they cover using the
repository's established framework conventions. Prefer focused tests for
validation, chunking, retrieval, API contracts, and error cases. Do not treat
dependency tests as project coverage.

## Reporting

Report the exact commands run and distinguish successful checks from checks
that were unavailable (for example, because credentials or Docker services
were not configured). Do not claim test coverage when only builds or lint ran.