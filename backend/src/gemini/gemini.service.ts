import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

@Injectable()
export class GeminiService implements OnModuleInit {
  private readonly logger = new Logger(GeminiService.name);
  private genAI!: GoogleGenerativeAI;

  private readonly EMBED_MODEL = "gemini-embedding-001";
  private readonly GEN_MODEL = "gemini-3.8-flash";

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
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
    });

    const result = await model.embedContent({
      content: {
        parts: [{ text }],
        role: "user",
      },
      taskType: taskType as any,
      outputDimensionality: 768,
    } as any);

    const values = result.embedding.values;

    if (!values || values.length !== 768) {
      throw new Error(
        `Unexpected embedding dimension: expected 768, got ${values?.length}`,
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
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    if (!text) {
      throw new Error("Gemini returned an empty response");
    }

    return text;
  }
}
