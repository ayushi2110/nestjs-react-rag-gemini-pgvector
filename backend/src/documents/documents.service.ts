import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Pool } from "pg";
import { randomUUID } from "crypto";
import { GeminiService } from "../gemini/gemini.service";
import { ChunkingService } from "./chunking.service";
import { DATABASE_POOL } from "../common/database.module";
import { IngestDto } from "./dto/ingest.dto";

export interface StoredChunk {
  id: number;
  document_id: string;
  title: string;
  content: string;
  metadata: Record<string, any>;
  created_at: Date;
}

export interface SimilarChunk extends StoredChunk {
  similarity: number;
}

export interface MetadataFilterOptions {
  metadataFilters?: Record<string, string | number | boolean>;
  candidateK?: number;
}

export interface IngestResult {
  documentId: string;
  title: string;
  chunksStored: number;
}

export interface DocumentStats {
  totalChunks: number;
  totalDocuments: number;
  oldestChunk: Date | null;
  newestChunk: Date | null;
}

export interface DocumentListItem {
  documentId: string;
  title: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  chunkCount: number;
}

export interface DocumentDetails extends DocumentListItem {
  chunks: Array<{ id: number; chunkIndex: number; content: string }>;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly gemini: GeminiService,
    private readonly chunker: ChunkingService,
  ) {}

  async ingestText(dto: IngestDto): Promise<IngestResult> {
    const { title, content, metadata = {} } = dto;

    const clean = this.chunker.cleanText(content);
    if (!clean)
      throw new BadRequestException(
        "Document content is empty after cleaning.",
      );

    const chunks = this.chunker.chunk(clean);
    if (chunks.length === 0)
      throw new BadRequestException("No chunks produced from content.");

    const documentId = randomUUID();

    this.logger.log(
      `Ingesting "${title}" → ${chunks.length} chunks (docId=${documentId})`,
    );

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (const chunk of chunks) {
        const embedding = await this.gemini.embed(
          chunk.content,
          "RETRIEVAL_DOCUMENT",
        );
        const vectorLiteral = `[${embedding.join(",")}]`;

        await client.query(
          `INSERT INTO documents (document_id, title, content, metadata, embedding)
           VALUES ($1, $2, $3, $4, $5::vector)`,
          [
            documentId,
            title,
            chunk.content,
            JSON.stringify({
              ...metadata,
              chunkIndex: chunk.chunkIndex,
              wordCount: chunk.wordCount,
            }),
            vectorLiteral,
          ],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      this.logger.error(`Ingestion failed for "${title}":`, err);
      throw new InternalServerErrorException("Failed to ingest document.");
    } finally {
      client.release();
    }

    return { documentId, title, chunksStored: chunks.length };
  }

  async ingestBuffer(
    title: string,
    textContent: string,
    extraMetadata: Record<string, any> = {},
  ): Promise<IngestResult> {
    return this.ingestText({
      title,
      content: textContent,
      metadata: extraMetadata,
    });
  }

  async findSimilar(
    queryEmbedding: number[],
    topK = 5,
    options: MetadataFilterOptions = {},
  ): Promise<SimilarChunk[]> {
    const vectorLiteral = `[${queryEmbedding.join(",")}]`;
    const limit = Math.max(
      topK,
      options.candidateK ?? Math.min(topK * 4, 20),
    );

    const { clauses, values } = this.buildMetadataFilters(
      options.metadataFilters ?? {},
    );
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const params: unknown[] = [vectorLiteral, ...values, limit];
    const limitIndex = params.length;

    const { rows } = await this.pool.query<SimilarChunk>(
      `SELECT
         id,
         document_id,
         title,
         content,
         metadata,
         created_at,
         1 - (embedding <=> $1::vector) AS similarity
       FROM documents
       ${whereClause}
       ORDER BY embedding <=> $1::vector
       LIMIT $${limitIndex}`,
      params,
    );

    return rows;
  }

  private buildMetadataFilters(
    metadataFilters: Record<string, string | number | boolean>,
  ): { clauses: string[]; values: unknown[] } {
    const clauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(metadataFilters)) {
      if (
        value === undefined ||
        value === null ||
        value === "" ||
        !/^[a-zA-Z0-9_-]+$/.test(key)
      ) {
        continue;
      }

      clauses.push(`metadata->>'${key}' = $${values.length + 2}`);
      values.push(String(value));
    }

    return { clauses, values };
  }

  async getStats(): Promise<DocumentStats> {
    const { rows } = await this.pool.query(`
      SELECT
        COUNT(*)::int                        AS "totalChunks",
        COUNT(DISTINCT document_id)::int     AS "totalDocuments",
        MIN(created_at)                      AS "oldestChunk",
        MAX(created_at)                      AS "newestChunk"
      FROM documents
    `);

    return rows[0] as DocumentStats;
  }

  async listDocuments(
    page = 1,
    pageSize = 20,
  ): Promise<{
    items: DocumentListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), 100);
    const offset = (safePage - 1) * safePageSize;
    const [documents, count] = await Promise.all([
      this.pool.query<DocumentListItem>(
        `SELECT
           document_id AS "documentId",
           title,
           (metadata - 'chunkIndex' - 'wordCount') AS metadata,
           MIN(created_at) AS "createdAt",
           COUNT(*)::int AS "chunkCount"
         FROM documents
         GROUP BY document_id, title, (metadata - 'chunkIndex' - 'wordCount')
         ORDER BY MIN(created_at) DESC, document_id
         LIMIT $1 OFFSET $2`,
        [safePageSize, offset],
      ),
      this.pool.query<{ total: number }>(
        "SELECT COUNT(DISTINCT document_id)::int AS total FROM documents",
      ),
    ]);

    return {
      items: documents.rows,
      total: count.rows[0].total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  async getDocument(documentId: string): Promise<DocumentDetails> {
    const { rows } = await this.pool.query<DocumentDetails>(
      `SELECT
         document_id AS "documentId",
         title,
         (metadata - 'chunkIndex' - 'wordCount') AS metadata,
         MIN(created_at) AS "createdAt",
         COUNT(*)::int AS "chunkCount",
         jsonb_agg(
           jsonb_build_object(
             'id', id,
             'chunkIndex', COALESCE((metadata->>'chunkIndex')::int, 0),
             'content', content
           ) ORDER BY COALESCE((metadata->>'chunkIndex')::int, 0), id
         ) AS chunks
       FROM documents
       WHERE document_id = $1
       GROUP BY document_id, title, (metadata - 'chunkIndex' - 'wordCount')`,
      [documentId],
    );

    if (!rows[0]) {
      throw new NotFoundException("Document not found.");
    }

    return rows[0];
  }

  async deleteDocument(documentId: string): Promise<void> {
    const result = await this.pool.query(
      "DELETE FROM documents WHERE document_id = $1",
      [documentId],
    );

    if (result.rowCount === 0) {
      throw new NotFoundException("Document not found.");
    }
  }
}
