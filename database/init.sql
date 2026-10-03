-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
  id          BIGSERIAL PRIMARY KEY,
  document_id UUID        NOT NULL DEFAULT uuid_generate_v4(),
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  embedding   VECTOR(768) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- HNSW index for cosine distance
CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx
  ON documents
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Index on document_id
CREATE INDEX IF NOT EXISTS documents_document_id_idx
  ON documents (document_id);

-- Index on created_at
CREATE INDEX IF NOT EXISTS documents_created_at_idx
  ON documents (created_at DESC);