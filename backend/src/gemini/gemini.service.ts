import {
  BadGatewayException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);
  private genAI!: GoogleGenerativeAI;

  private readonly EMBED_MODEL = "gemini-embedding-001";
  private readonly GEN_MODEL = "gemini-3.8-flash";

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const apiKey = this.config.getOrThrow<string>("GEMINI_API_KEY");
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.logger.log(
      `Gemini initialised (embed=${this.EMBED_MODEL}, gen=${this.GEN_MODEL})`,
    );
  }

  async embed(
    text: string,
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT",
  ): Promise<number[]> {
    const model = this.genAI.getGenerativeModel({
      model: this.EMBED_MODEL,
    }, { timeout: this.getSetting("GEMINI_REQUEST_TIMEOUT_MS", 30000, 1000) });

    const request = {
        content: {
          parts: [{ text }],
          role: "user",
        },
        taskType:
          taskType === "RETRIEVAL_QUERY"
            ? TaskType.RETRIEVAL_QUERY
            : TaskType.RETRIEVAL_DOCUMENT,
        outputDimensionality: 768,
    };
    const result = await this.withRetry("embedding", () =>
      model.embedContent(request),
    );

    const values = result.embedding.values;

    if (!values || values.length !== 768) {
      this.logger.error(
        `Gemini returned an invalid embedding dimension (expected=768, actual=${values?.length ?? 0})`,
      );
      throw new BadGatewayException(
        "The AI service returned an invalid embedding. Please try again.",
      );
    }

    return values;
  }

  async generate(prompt: string): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: this.GEN_MODEL,
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 2048,
      },
    }, { timeout: this.getSetting("GEMINI_REQUEST_TIMEOUT_MS", 30000, 1000) });

    const result = await this.withRetry("generation", () =>
      model.generateContent(prompt),
    );
    let text: string;
    try {
      text = result.response.text();
    } catch {
      this.logger.warn("Gemini returned a response without readable text");
      throw new BadGatewayException(
        "The AI service returned an unusable response. Please try again.",
      );
    }

    if (!text.trim()) {
      this.logger.warn("Gemini returned an empty response");
      throw new BadGatewayException(
        "The AI service returned an empty response. Please try again.",
      );
    }

    return text;
  }

  private async withRetry<T>(
    operation: string,
    request: () => Promise<T>,
  ): Promise<T> {
    const maxRetries = this.getSetting("GEMINI_MAX_RETRIES", 3, 0, 10);
    const baseDelay = this.getSetting("GEMINI_RETRY_BASE_DELAY_MS", 500, 1);
    const maxDelay = this.getSetting("GEMINI_RETRY_MAX_DELAY_MS", 8000, 1);

    for (let attempt = 1; ; attempt++) {
      try {
        return await request();
      } catch (error) {
        const statusCode = this.getStatusCode(error);
        const retryable = statusCode !== undefined &&
          RETRYABLE_STATUS_CODES.has(statusCode);
        if (!retryable || attempt > maxRetries) {
          this.logger.error(
            `Gemini ${operation} failed (status=${statusCode ?? "unknown"}, attempts=${attempt})`,
          );
          if (retryable) {
            throw new ServiceUnavailableException(
              "The AI service is temporarily unavailable. Please try again shortly.",
            );
          }
          throw new BadGatewayException(
            "The AI service could not complete the request. Please try again.",
          );
        }

        const cappedDelay = Math.min(
          maxDelay,
          baseDelay * 2 ** (attempt - 1),
        );
        const jitter = Math.floor(Math.random() * Math.max(1, cappedDelay * 0.2));
        const delay = Math.min(maxDelay, cappedDelay + jitter);
        this.logger.warn(
          `Retrying Gemini ${operation} (attempt=${attempt}/${maxRetries}, status=${statusCode}, delayMs=${delay})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private getStatusCode(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const candidate = error as {
      status?: unknown;
      statusCode?: unknown;
      response?: { status?: unknown };
    };
    const status = Number(
      candidate.status ?? candidate.statusCode ?? candidate.response?.status,
    );
    return Number.isInteger(status) ? status : undefined;
  }

  private getSetting(
    name: string,
    defaultValue: number,
    minimum: number,
    maximum = Number.MAX_SAFE_INTEGER,
  ): number {
    const value = Number(this.config.get(name, defaultValue));
    if (!Number.isFinite(value)) return defaultValue;
    return Math.min(maximum, Math.max(minimum, Math.floor(value)));
  }
}
