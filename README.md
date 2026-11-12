# 🔍 RAG Assistant

> A Retrieval-Augmented Generation (RAG) chat application built with NestJS, React, PostgreSQL + pgvector, and Google Gemini.

---

## ✨ Features

- 💬 **Chat Interface** — Clean, responsive chat UI built with React + Vite
- 🧠 **Semantic Search** — pgvector HNSW index for fast cosine similarity search
- 📄 **Document Ingestion** — Upload PDF, DOCX, TXT, MD files or paste text directly
- 🤖 **Gemini Powered** — `gemini-embedding-001` for embeddings, `gemini-3.8-flash` for generation
- 🔁 **Resilient AI Requests** — Configurable timeout and exponential-backoff retries for temporary Gemini errors
- 🗜️ **Token Optimized** — TOON format compresses context sent to Gemini
- 🔒 **Grounded Answers** — Similarity-filtered evidence, with leave-policy distinctions and an explicit no-evidence fallback
- 📊 **Source Attribution** — Every answer shows expandable source chunks with similarity scores
- 📈 **Retrieval Evaluation** — Recall@K, Precision@K, MRR, and Hit Rate@K against configurable ground truth

---

## 🛠️ Tech Stack

| Layer     | Technology                                             |
| --------- | ------------------------------------------------------ |
| Frontend  | React + Vite + TypeScript                               |
| Backend   | NestJS + TypeScript                                    |
| Database  | PostgreSQL 16 + pgvector                               |
| AI Models | Google Gemini (gemini-embedding-001, gemini-3.8-flash) |
| Container | Docker + pgAdmin                                       |

---

## 📁 Project Structure

```
rag-app/
├── 📄 docker-compose.yml
├── 📄 .env.example
├── 📄 .gitignore
│
├── 📂 database/
│   └── init.sql              # pgvector schema + HNSW index
│
├── 📂 frontend/              # React + Vite app
│   └── src/
│       ├── App.tsx
│       ├── index.css
│       ├── components/
│       │   ├── ChatMessage.tsx
│       │   ├── SourceCard.tsx
│       │   └── UploadPanel.tsx
│       ├── hooks/
│       │   └── useChat.ts
│       └── types/
│           └── index.ts
│
└── 📂 backend/               # NestJS app
    └── src/
        ├── main.ts
        ├── app.module.ts
        ├── common/
        │   └── database.module.ts
        ├── gemini/
        │   ├── gemini.module.ts
        │   └── gemini.service.ts
        ├── documents/
        │   ├── documents.module.ts
        │   ├── documents.service.ts
        │   ├── documents.controller.ts
        │   ├── chunking.service.ts
        │   └── dto/ingest.dto.ts
        ├── auth/
        │   ├── auth.module.ts
        │   ├── auth.controller.ts
        │   ├── auth.service.ts
        │   ├── guards/
        │   └── strategies/
        └── chat/
            ├── chat.module.ts
            ├── chat.service.ts
            ├── chat.controller.ts
            └── dto/chat.dto.ts
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Google Gemini API Key](https://makersuite.google.com/app/apikey)

---

### 1. Clone the repository

```bash
git clone https://github.com/your-username/rag-app.git
cd rag-app
```

### 2. Setup environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

```env
POSTGRES_USER=raguser
POSTGRES_PASSWORD=ragpassword
POSTGRES_DB=ragdb
DATABASE_URL=postgresql://raguser:ragpassword@localhost:5432/ragdb
GEMINI_API_KEY=your_gemini_api_key_here
PGADMIN_DEFAULT_EMAIL=your@email.com
PGADMIN_DEFAULT_PASSWORD=yourpassword
```

Also copy for backend:

```bash
cp .env.example backend/.env
```

Generate separate strong authentication secrets (at least 32 random bytes):

```bash
openssl rand -base64 48
```

Set the generated values as `AUTH_JWT_SECRET` and `AUTH_CSRF_SECRET`, configure
`FRONTEND_ORIGINS` to the exact browser origin(s), and set
`AUTH_COOKIE_SAME_SITE=none` for cross-site frontend/API hosting. Secure cookies
require HTTPS outside localhost. See
[`docs/authentication-and-authorization.md`](docs/authentication-and-authorization.md)
for complete setup and migration instructions.

### 3. Start the database

```bash
docker compose up -d
```

### 4. Start the backend

```bash
cd backend
npm install
npm run start:dev
```

Backend runs at → `http://localhost:3000/api`

After applying the database migration and configuring the one-time bootstrap
credentials in `backend/.env`, provision the single administrator:

```bash
cd backend
npm run seed:admin
```

Remove `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` from the runtime
environment after seeding. There is no public signup endpoint.

### 5. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at → `http://localhost:5173`

---

## 🔌 API Endpoints

| Method | Endpoint                | Description                           |
| ------ | ----------------------- | ------------------------------------- |
| `POST` | `/api/chat`             | Ask a question, get a grounded answer |
| `GET`  | `/api/chat/evaluation`  | Evaluate retrieval against configured questions and ground truth |
| `GET`  | `/api/auth/csrf`        | Bootstrap CSRF token                  |
| `POST` | `/api/auth/login`       | Admin login                           |
| `POST` | `/api/auth/refresh`     | Rotate admin refresh token            |
| `POST` | `/api/auth/logout`      | Revoke current admin session          |
| `GET`  | `/api/auth/me`          | Current admin profile                 |
| `GET`  | `/api/documents`        | List documents (admin only)           |
| `GET`  | `/api/documents/:id`    | View document chunks (admin only)     |
| `POST` | `/api/documents/ingest` | Ingest text (admin only)              |
| `POST` | `/api/documents/upload` | Upload file (admin only)              |
| `DELETE` | `/api/documents/:id`  | Delete document (admin only)          |
| `GET`  | `/api/documents/stats`  | Knowledge base stats (admin only)     |

`POST /api/chat` remains public and preserves its existing answer/source
response. Document management endpoints require an admin bearer access token.

### Example — Ask a question

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{ "question": "What is the leave policy?" }'
```

### Example — Ingest text as admin

```bash
curl -X POST http://localhost:3000/api/documents/ingest \
  -H "Authorization: Bearer <admin-access-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Leave Policy",
    "content": "Employees get 20 days of paid leave per year..."
  }'
```

---

## 🗄️ Database Schema

```sql
CREATE TABLE documents_table_name (
  id          BIGSERIAL PRIMARY KEY,
  document_id UUID        NOT NULL,
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  embedding   VECTOR(768) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW index for fast cosine similarity search
CREATE INDEX documents_embedding_hnsw_idx
  ON documents USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

## 🧠 How RAG Works

```
User Question
     │
     ▼
Embed question (gemini-embedding-001)
     │
     ▼
pgvector similarity search (<=> cosine distance)
     │
     ▼
Retrieve candidate chunks (about 4× topK, capped at 20)
     │
     ▼
Convert cosine distance to similarity (1 - distance)
Apply metadata filters and minimum similarity threshold
     │
     ├── No reliable context → fallback answer, no Gemini generation
     ▼
Select at most topK chunks
     │
     ▼
Convert to TOON format (token efficient)
     │
     ▼
Build grounded prompt → Gemini (gemini-3.8-flash)
     │
     ▼
Answer + Sources returned to user
```

Chat defaults to `topK=5`; the API response remains `{ "answer": "...",
"sources": [...] }`. Sources include only chunks used as context. The prompt
instructs Gemini to rely only on those chunks, ignore instructions embedded in
uploaded text, cite document titles, report conflicts, and distinguish annual,
sick, and casual leave as well as policy entitlement from an individual
employee's remaining balance. If no chunks meet the similarity threshold,
generation is skipped and the answer is
`I couldn't find enough information in the available documents.` with an empty
sources array.

### Retrieval evaluation

`GET /api/chat/evaluation` runs the retrieval path without calling Gemini for
answer generation. The built-in sample questions have no expected IDs, so their
metrics are returned as unavailable (`null`), not as zero. Configure
`RAG_EVALUATION_DATASET` as a JSON array to supply labeled questions:

```json
[
  {
    "question": "What is the annual leave policy for 2026?",
    "expectedDocumentIds": ["document-uuid"],
    "expectedChunkIds": [123, 124]
  }
]
```

For labeled entries, the endpoint reports expected and retrieved document/chunk
IDs, whether expected evidence was found, Recall@K, Precision@K, MRR, and Hit
Rate@K. Replace the example IDs with IDs from your database.

---

## 🔧 Environment Variables

| Variable                   | Description                        | Required |
| -------------------------- | ---------------------------------- | -------- |
| `DATABASE_URL`             | PostgreSQL connection string       | ✅       |
| `GEMINI_API_KEY`           | Google Gemini API key              | ✅       |
| `GEMINI_REQUEST_TIMEOUT_MS` | Gemini request timeout in milliseconds (default: 30000) | ❌ |
| `GEMINI_MAX_RETRIES`        | Retries after the initial request for temporary 408/429/5xx errors (default: 3) | ❌ |
| `GEMINI_RETRY_BASE_DELAY_MS` | Initial exponential retry delay with jitter (default: 500) | ❌ |
| `GEMINI_RETRY_MAX_DELAY_MS` | Maximum retry delay (default: 8000) | ❌ |
| `RAG_MAX_CANDIDATES`        | Maximum retrieval candidates; never below requested topK (default: 20) | ❌ |
| `RAG_MIN_SIMILARITY`        | Minimum cosine similarity, calculated as 1 − cosine distance (default: 0.35) | ❌ |
| `RAG_EVALUATION_DATASET`    | JSON evaluation questions with expected document/chunk IDs (default: `[]`) | ❌ |
| `POSTGRES_USER`            | PostgreSQL username                | ✅       |
| `POSTGRES_PASSWORD`        | PostgreSQL password                | ✅       |
| `POSTGRES_DB`              | PostgreSQL database name           | ✅       |
| `PGADMIN_DEFAULT_EMAIL`    | pgAdmin login email                | ✅       |
| `PGADMIN_DEFAULT_PASSWORD` | pgAdmin login password             | ✅       |
| `PORT`                     | Backend port (default: 3000)       | ❌       |
| `NODE_ENV`                 | Environment (default: development) | ❌       |
| `FRONTEND_ORIGINS`         | Exact comma-separated browser origins for credentialed CORS | ✅ |
| `AUTH_JWT_SECRET`          | JWT signing secret, at least 32 characters | ✅ |
| `AUTH_CSRF_SECRET`         | CSRF signing secret, separate from JWT key, at least 32 characters | ✅ |
| `AUTH_ACCESS_TTL_SECONDS`  | Access-token lifetime (default: 600) | ❌ |
| `AUTH_REFRESH_TTL_SECONDS` | Refresh-session lifetime (default: 604800) | ❌ |
| `AUTH_COOKIE_SECURE`       | Secure cookie flag; must remain `true` | ✅ |
| `AUTH_COOKIE_SAME_SITE`    | `none` for cross-site, or `lax`/`strict` for same-site | ✅ |
| `ADMIN_BOOTSTRAP_EMAIL`    | One-time seed credential; remove after provisioning | Seed only |
| `ADMIN_BOOTSTRAP_PASSWORD` | One-time seed credential; remove after provisioning | Seed only |

---

## 📦 Supported File Types

| Format        | Extension |
| ------------- | --------- |
| Plain Text    | `.txt`    |
| Markdown      | `.md`     |
| PDF           | `.pdf`    |
| Word Document | `.docx`   |

Max file size: **20 MB**

---

## 🖥️ pgAdmin

Access the database UI at `http://localhost:5050`

| Field    | Value                           |
| -------- | ------------------------------- |
| Email    | your `PGADMIN_DEFAULT_EMAIL`    |
| Password | your `PGADMIN_DEFAULT_PASSWORD` |
| Host     | `rag_postgres`                  |
| Port     | `5432`                          |
| Database | `databaseName`                         |
| Username | `databaseUserName`                       |

---

## 📝 License

MIT

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first.
