import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  InternalServerErrorException,
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
  ): Promise<SimilarChunk[]> {
    const vectorLiteral = `[${queryEmbedding.join(",")}]`;

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
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vectorLiteral, topK],
    );

    return rows;
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
}
