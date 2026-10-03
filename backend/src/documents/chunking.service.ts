import { Injectable, Logger } from "@nestjs/common";

export interface TextChunk {
  content: string;
  chunkIndex: number;
  wordCount: number;
}

@Injectable()
export class ChunkingService {
  private readonly logger = new Logger(ChunkingService.name);

  private readonly DEFAULT_CHUNK_SIZE = 500;
  private readonly DEFAULT_OVERLAP = 80;

  chunk(
    text: string,
    chunkSize = this.DEFAULT_CHUNK_SIZE,
    overlap = this.DEFAULT_OVERLAP,
  ): TextChunk[] {
    const normalised = text.replace(/\s+/g, " ").trim();
    const words = normalised.split(" ").filter(Boolean);

    if (words.length === 0) return [];

    if (words.length <= chunkSize) {
      return [
        {
          content: words.join(" "),
          chunkIndex: 0,
          wordCount: words.length,
        },
      ];
    }

    const chunks: TextChunk[] = [];
    let start = 0;
    let chunkIndex = 0;

    while (start < words.length) {
      const end = Math.min(start + chunkSize, words.length);
      const chunkWords = words.slice(start, end);

      chunks.push({
        content: chunkWords.join(" "),
        chunkIndex,
        wordCount: chunkWords.length,
      });

      chunkIndex++;
      const step = Math.max(1, chunkSize - overlap);
      start += step;

      if (start >= words.length) break;
    }

    this.logger.debug(
      `Chunked ${words.length} words → ${chunks.length} chunks`,
    );

    return chunks;
  }

  cleanText(raw: string): string {
    return raw
      .replace(/\r\n/g, "\n")
      .replace(/\f/g, "\n")
      .replace(/\t/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
}
