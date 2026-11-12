# Architecture

## System overview

This repository contains a React/Vite frontend, a NestJS API, and a PostgreSQL
database using pgvector. Google Gemini provides document/query embeddings and
grounded answer generation. Docker Compose runs PostgreSQL and pgAdmin; the
frontend and API are run separately during development.

## Repository structure

```text
database/init.sql                 PostgreSQL extensions, schema, and indexes
backend/src/
  main.ts                          Nest bootstrap, validation, CORS, /api prefix
  app.module.ts                    Root module and global configuration
  common/database.module.ts        Shared PostgreSQL connection pool
  auth/                            Single-admin login, JWT sessions, guards, seed
  gemini/                          Gemini client with retries and request timeouts
  documents/                       Ingestion, chunking, upload, and retrieval
  chat/                            Chat and retrieval-evaluation endpoints
frontend/src/
  App.tsx                          Application layout and chat input state
  components/                      ChatMessage, SourceCard, UploadPanel
  hooks/useChat.ts                 Chat state and HTTP request helpers
  types/index.ts                   Frontend API and UI types
  index.css                        Global styles and design tokens
github/instructions/                Repository guidance documents
```

## Request and data flow

### Chat

`App` calls `useChat.sendMessage` → `useChat.ts` POSTs to `/api/chat` → the
NestJS `ChatController` validates the request → `ChatService` embeds the
question, asks `DocumentsService` for nearest chunks, applies the configured
similarity threshold, builds a grounded prompt, and asks Gemini to generate an
answer. The API returns `{ answer, sources }`; the UI displays source snippets
and similarity scores.

### Ingestion

`UploadPanel` calls the request helpers in `hooks/useChat.ts` for text or file
ingestion. `DocumentsController` validates file type and the 20 MB limit,
extracts text, and delegates to `DocumentsService`. Text is cleaned and split
into 500-word chunks with 80-word overlap. Each chunk is embedded and inserted
as a row in one transaction. Embedding and generation calls use the configured
Gemini timeout and retry temporary provider failures with exponential backoff
and jitter.

## Backend modules

- `AppModule` loads environment configuration and imports the database, Gemini,
  documents, and chat modules.
- `DatabaseModule` exports a shared `pg` connection pool.
- `AuthModule` provides one-time admin provisioning, Argon2id password
  verification, short-lived JWT access tokens, rotating database-backed
  refresh sessions, CSRF validation, and ADMIN/JWT guards.
- `GeminiModule` owns the Gemini SDK integration: `gemini-embedding-001`
  embeddings with 768 dimensions and `gemini-3.8-flash` generation. It retries
  408, 429, 500, 502, 503, and 504 responses, up to three retries by default.
  Other provider failures are not retried; NestJS errors use safe messages
  without exposing provider details or credentials.
- `DocumentsModule` handles text/file ingestion, chunk creation, pgvector
  similarity search, metadata filters, and document statistics.
- `ChatModule` implements chat and the retrieval-evaluation endpoint.

## Database and retrieval

`database/init.sql` enables `vector` and `uuid-ossp`, creates `documents`, and
adds a cosine-distance HNSW index plus document ID and creation-time indexes.
Each row is a chunk with a shared `document_id`, title, content, JSONB metadata,
768-dimensional embedding, and creation timestamp.

Similarity search orders by pgvector cosine distance and returns similarity as
`1 - cosine_distance`. Chat defaults to `topK=5`; it retrieves approximately
four times `topK` candidates, bounded by `RAG_MAX_CANDIDATES` (default 20) and
never fewer than the requested `topK`. It filters by `RAG_MIN_SIMILARITY`
(default 0.35), then selects at most `topK` chunks. Year, department, region,
status, and version filters are heuristically extracted from questions and
compared against JSONB metadata.

If no chunk meets the threshold, the API returns the existing response shape
without calling Gemini:

```json
{
  "answer": "I couldn't find enough information in the available documents.",
  "sources": []
}
```

Otherwise, only the selected chunks are sent as untrusted reference material.
The prompt requires context-only answers, citations by document title, conflict
disclosure, accurate year/category distinctions for leave policies, and no
inference of an employee's remaining balance from a general entitlement.

`GET /api/chat/evaluation` runs retrieval without generation. The default sample
questions have no known ground-truth IDs, so their evaluation metrics are
`null` and marked unavailable rather than reported as zero. Set
`RAG_EVALUATION_DATASET` to a JSON array of objects with `question` and optional
`expectedDocumentIds` (string IDs) and/or `expectedChunkIds` (integer IDs) to
enable Recall@K, Precision@K, reciprocal rank/MRR, and Hit Rate@K.

Optional Gemini and retrieval settings are `GEMINI_REQUEST_TIMEOUT_MS`
(default 30000), `GEMINI_MAX_RETRIES` (3), `GEMINI_RETRY_BASE_DELAY_MS` (500),
`GEMINI_RETRY_MAX_DELAY_MS` (8000), `RAG_MAX_CANDIDATES` (20),
`RAG_MIN_SIMILARITY` (0.35), and `RAG_EVALUATION_DATASET` (`[]`).

## API contract

The global route prefix is `/api`.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/chat` | Grounded answer and retrieved source details |
| `GET` | `/api/chat/evaluation` | Retrieval evaluation for configured/default questions; no generation |
| `GET` | `/api/auth/csrf` | Bootstrap signed CSRF token |
| `POST` | `/api/auth/login` | Admin login; sets refresh cookie |
| `POST` | `/api/auth/refresh` | Rotate refresh token and issue access token |
| `POST` | `/api/auth/logout` | Revoke current admin session |
| `GET` | `/api/auth/me` | Current authenticated admin profile |
| `GET` | `/api/documents` | Paginated document list (admin only) |
| `GET` | `/api/documents/:documentId` | Read document chunks (admin only) |
| `POST` | `/api/documents/ingest` | Ingest title, text, and optional metadata |
| `POST` | `/api/documents/upload` | Ingest a PDF, DOCX, TXT, or Markdown file (max 20 MB) |
| `GET` | `/api/documents/stats` | Chunk/document counts (admin only) |
| `DELETE` | `/api/documents/:documentId` | Delete all chunks for a document (admin only) |

`POST /api/chat` accepts a required `question` and optional integer `topK` from
1 to 20. Its response remains `{ answer, sources }`; each source contains the
title, snippet, similarity score, and document ID. Text ingestion requires a
title and content of at least 10 characters.

## Frontend

The frontend is React + TypeScript + Vite. `App.tsx` routes public chat and the
admin pages. The public chat does not render document controls. Components
render UI; chat state and requests live in `hooks/useChat.ts`; admin state lives
in the auth context/provider and `hooks/useAdminAuth.ts`. Admin API calls use
`api/adminApi.ts`. Styles are global CSS in `index.css`; Vite proxies `/api` to
`http://localhost:3000` in development. Set `VITE_API_URL` to a server origin
when the frontend should not use that proxy.

## Security, errors, and operations

`POST /api/chat` is public and still returns grounded answers and source
snippets. All direct document-management endpoints (list, detail, stats,
ingest, upload, delete) require a valid admin JWT and ADMIN role. The frontend
also has protected admin routes, but backend guards are the security boundary.
There is exactly one admin row, enforced by the singleton database key/check
constraint; there is no public signup.

Refresh tokens are random opaque values stored only as SHA-256 hashes in the
database and rotated per use. Access tokens are short-lived JWTs, checked
against active database sessions on each protected request so logout revokes
them immediately. The refresh cookie is HttpOnly, Secure, host-only and uses
SameSite settings; the signed CSRF cookie/header pair protects login, refresh,
and logout. Credentialed CORS accepts only configured frontend origins.
See `docs/authentication-and-authorization.md` for provisioning, migration,
cookie and deployment details.

Nest applies a global `ValidationPipe` with transformation, whitelisting, and
rejection of unknown fields. Controllers use Nest exceptions for invalid
requests and unsupported/unparseable uploads. Ingestion uses a database
transaction and rolls back on failure. The frontend checks HTTP status and
renders request errors; failure to load document statistics is intentionally
non-critical.

Chat logs include question length (not question or document contents), timing
for embedding, vector search, context construction, generation, and total
requests, plus candidate scores, threshold filtering counts, and selected
chunk IDs. Database retrieval failures return a safe service-unavailable
response; exhausted temporary Gemini errors return 503 and permanent Gemini
failures return 502.

`docker-compose.yml` runs only PostgreSQL 16 with pgvector and pgAdmin. The
auth schema migration is mounted for fresh database volumes; apply it manually
to existing volumes as documented in `docs/authentication-and-authorization.md`.
Backend auth/service/authorization and chat/Gemini tests run with
`cd backend && npm test`;
frontend lint and build commands are defined, but no frontend test runner is
configured.
