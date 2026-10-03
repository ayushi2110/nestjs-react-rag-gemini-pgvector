import { Injectable, Logger } from "@nestjs/common";
import { GeminiService } from "../gemini/gemini.service";
import { DocumentsService, SimilarChunk } from "../documents/documents.service";
import { ChatDto } from "./dto/chat.dto";

let toonStringify: (obj: unknown) => string;
try {
  const toon = require("@toon-format/toon");
  toonStringify = toon.stringify ?? toon.default?.stringify ?? JSON.stringify;
} catch {
  toonStringify = JSON.stringify;
}

export interface ChatSource {
  title: string;
  snippet: string;
  similarity: number;
  documentId: string;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly documents: DocumentsService,
  ) {}

  async chat(dto: ChatDto): Promise<ChatResponse> {
    const { question, topK = 5 } = dto;

    this.logger.log(`Chat: "${question}" (topK=${topK})`);

    // Step 1: Embed question
    const queryEmbedding = await this.gemini.embed(question, "RETRIEVAL_QUERY");

    // Step 2: Retrieve similar chunks
    const similarChunks = await this.documents.findSimilar(
      queryEmbedding,
      topK,
    );

    if (similarChunks.length === 0) {
      return {
        answer:
          "I could not find any relevant information in the knowledge base. " +
          "Please make sure documents have been ingested, or try rephrasing your question.",
        sources: [],
      };
    }

    // Step 3: Convert to TOON format
    const toonContext = this.buildToonContext(similarChunks);

    // Step 4: Build prompt
    const prompt = this.buildPrompt(question, toonContext);

    // Step 5: Generate answer
    const answer = await this.gemini.generate(prompt);

    // Step 6: Build sources
    const sources: ChatSource[] = similarChunks.map((chunk) => ({
      title: chunk.title,
      snippet:
        chunk.content.slice(0, 200).trimEnd() +
        (chunk.content.length > 200 ? "…" : ""),
      similarity: Math.round(chunk.similarity * 1000) / 1000,
      documentId: chunk.document_id,
    }));

    return { answer, sources };
  }

  private buildToonContext(chunks: SimilarChunk[]): string {
    const contextObjects = chunks.map((chunk, i) => ({
      id: i + 1,
      title: chunk.title,
      similarity: chunk.similarity.toFixed(3),
      content: chunk.content,
    }));

    try {
      return toonStringify(contextObjects);
    } catch {
      return JSON.stringify(contextObjects, null, 2);
    }
  }

  private buildPrompt(question: string, toonContext: string): string {
    return `You are an internal company knowledge assistant.
Your job is to answer employee questions accurately using ONLY the information provided in the CONTEXT section below.

RULES:
1. Answer strictly from the provided context. Do NOT use any outside knowledge.
2. If the context does not contain enough information, respond: "I don't have sufficient information in the knowledge base to answer this question."
3. Be professional, clear, and concise.
4. When relevant, mention which document the information comes from.
5. Do not fabricate or infer information not explicitly stated in the context.

CONTEXT (TOON format):
---
${toonContext}
---

EMPLOYEE QUESTION:
${question}

ANSWER:`;
  }
}
