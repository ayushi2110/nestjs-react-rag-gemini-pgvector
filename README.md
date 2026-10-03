# 🔍 RAG Assistant

> A production-ready Retrieval-Augmented Generation (RAG) chat application built with NestJS, React, PostgreSQL + pgvector, and Google Gemini.

---

## ✨ Features

- 💬 **Chat Interface** — Clean, responsive chat UI built with React + Vite
- 🧠 **Semantic Search** — pgvector HNSW index for fast cosine similarity search
- 📄 **Document Ingestion** — Upload PDF, DOCX, TXT, MD files or paste text directly
- 🤖 **Gemini Powered** — `gemini-embedding-001` for embeddings, `gemini-2.0-flash` for generation
- 🗜️ **Token Optimized** — TOON format compresses context sent to Gemini
- 🔒 **Grounded Answers** — Model answers ONLY from uploaded documents
- 📊 **Source Attribution** — Every answer shows expandable source chunks with similarity scores

---

## 🛠️ Tech Stack

| Layer     | Technology                                             |
| --------- | ------------------------------------------------------ |
| Frontend  | React 18 + Vite + TypeScript                           |
| Backend   | NestJS + TypeScript                                    |
| Database  | PostgreSQL 16 + pgvector                               |
| AI Models | Google Gemini (gemini-embedding-001, gemini-2.0-flash) |
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
| `POST` | `/api/documents/ingest` | Ingest plain text document            |
| `POST` | `/api/documents/upload` | Upload a file (PDF, DOCX, TXT, MD)    |
| `GET`  | `/api/documents/stats`  | Get knowledge base statistics         |

### Example — Ask a question

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{ "question": "What is the leave policy?" }'
```

### Example — Ingest text

```bash
curl -X POST http://localhost:3000/api/documents/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Leave Policy",
    "content": "Employees get 20 days of paid leave per year..."
  }'
```

---

## 🗄️ Database Schema

```sql
CREATE TABLE documents (
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
Retrieve top-K chunks
     │
     ▼
Convert to TOON format (token efficient)
     │
     ▼
Build grounded prompt → Gemini (gemini-2.0-flash)
     │
     ▼
Answer + Sources returned to user
```

---

## 🔧 Environment Variables

| Variable                   | Description                        | Required |
| -------------------------- | ---------------------------------- | -------- |
| `DATABASE_URL`             | PostgreSQL connection string       | ✅       |
| `GEMINI_API_KEY`           | Google Gemini API key              | ✅       |
| `POSTGRES_USER`            | PostgreSQL username                | ✅       |
| `POSTGRES_PASSWORD`        | PostgreSQL password                | ✅       |
| `POSTGRES_DB`              | PostgreSQL database name           | ✅       |
| `PGADMIN_DEFAULT_EMAIL`    | pgAdmin login email                | ✅       |
| `PGADMIN_DEFAULT_PASSWORD` | pgAdmin login password             | ✅       |
| `PORT`                     | Backend port (default: 3000)       | ❌       |
| `NODE_ENV`                 | Environment (default: development) | ❌       |

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
| Database | `ragdb`                         |
| Username | `raguser`                       |

---

## 📝 License

MIT

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first.
