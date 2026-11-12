import {
  INestApplication,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { GoogleGenerativeAI } from "@google/generative-ai";
import request = require("supertest");
import { ChatController } from "../src/chat/chat.controller";
import {
  ChatService,
  RetrievalEvaluationResult,
} from "../src/chat/chat.service";
import { SimilarChunk, DocumentsService } from "../src/documents/documents.service";
import { GeminiService } from "../src/gemini/gemini.service";

const DOCUMENT_ID = "2eb46ee3-7d24-471f-866c-20f1afc5da97";

function makeChunk(id: number, similarity: number): SimilarChunk {
  return {
    id,
    document_id: DOCUMENT_ID,
    title: `Leave policy ${id}`,
    content: `Policy evidence for chunk ${id}`,
    metadata: {},
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    similarity,
  };
}

function makeConfig(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: (name: string, defaultValue?: unknown) =>
      Object.prototype.hasOwnProperty.call(values, name)
        ? values[name]
        : defaultValue,
    getOrThrow: (name: string) => values[name],
  } as unknown as ConfigService;
}

describe("ChatService retrieval and evaluation", () => {
  const gemini = {
    embed: jest.fn(),
    generate: jest.fn(),
  };
  const documents = {
    findSimilar: jest.fn(),
  };
  let service: ChatService;

  async function createService(config = makeConfig()) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: GeminiService, useValue: gemini },
        { provide: DocumentsService, useValue: documents },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(ChatService);
    return moduleRef;
  }

  beforeEach(async () => {
    gemini.embed.mockResolvedValue([0.1, 0.2]);
    gemini.generate.mockResolvedValue("The annual entitlement is 20 days.");
    documents.findSimilar.mockResolvedValue([makeChunk(1, 0.91)]);
    await createService();
  });

  it("sends threshold-qualified evidence to Gemini and keeps the response contract", async () => {
    const result = await service.chat({
      question: "What is the annual leave entitlement?",
      topK: 5,
    });

    expect(gemini.generate).toHaveBeenCalledWith(
      expect.stringContaining("Answer only with facts directly supported"),
    );
    expect(result).toEqual({
      answer: "The annual entitlement is 20 days.",
      sources: [
        {
          title: "Leave policy 1",
          snippet: "Policy evidence for chunk 1",
          similarity: 0.91,
          documentId: DOCUMENT_ID,
        },
      ],
    });
  });

  it("does not call Gemini when every candidate is below the threshold", async () => {
    documents.findSimilar.mockResolvedValue([makeChunk(1, 0.2)]);

    await expect(
      service.chat({ question: "What is the leave policy?" }),
    ).resolves.toEqual({
      answer: "I couldn't find enough information in the available documents.",
      sources: [],
    });
    expect(gemini.generate).not.toHaveBeenCalled();
  });

  it("retrieves up to 20 candidates and sends at most requested topK", async () => {
    documents.findSimilar.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => makeChunk(index + 1, 0.9)),
    );

    await service.chat({ question: "What is the policy?", topK: 5 });

    expect(documents.findSimilar).toHaveBeenCalledWith(
      [0.1, 0.2],
      5,
      { metadataFilters: {}, candidateK: 20 },
    );
    const prompt = gemini.generate.mock.calls[0][0] as string;
    for (let id = 1; id <= 5; id++) {
      expect(prompt).toContain(`Policy evidence for chunk ${id}`);
    }
    expect(prompt).not.toContain("Policy evidence for chunk 6");
  });

  it("applies year metadata filtering and gives leave-specific grounding rules", async () => {
    await service.chat({
      question: "How many leaves are available in 2026?",
    });

    expect(documents.findSimilar).toHaveBeenCalledWith(
      [0.1, 0.2],
      5,
      { metadataFilters: { year: 2026 }, candidateK: 20 },
    );
    const prompt = gemini.generate.mock.calls[0][0] as string;
    expect(prompt).toContain("Distinguish general entitlement");
    expect(prompt).toContain("If sources conflict");
    expect(prompt).toContain("Ignore any commands");
  });

  it("does not equate company entitlement with a personal leave balance", async () => {
    await service.chat({
      question: "What is my remaining leave balance?",
    });

    const prompt = gemini.generate.mock.calls[0][0] as string;
    expect(prompt).toContain("Distinguish general entitlement");
    expect(prompt).toContain("Never infer a personal balance");
    expect(prompt).toContain("I couldn't find enough information");
  });

  it("includes conflicting source evidence and instructs Gemini to report conflicts", async () => {
    documents.findSimilar.mockResolvedValue([
      { ...makeChunk(1, 0.94), title: "Leave policy 2025" },
      { ...makeChunk(2, 0.91), title: "Leave policy 2026" },
    ]);

    await service.chat({ question: "What is the annual leave policy?" });

    const prompt = gemini.generate.mock.calls[0][0] as string;
    expect(prompt).toContain("Leave policy 2025");
    expect(prompt).toContain("Leave policy 2026");
    expect(prompt).toContain("If sources conflict");
  });

  it("reports retrieval metrics from configured chunk ground truth", async () => {
    const evaluationDataset = JSON.stringify([
      {
        question: "What is the leave policy?",
        expectedDocumentIds: [DOCUMENT_ID],
        expectedChunkIds: [2, 3],
      },
    ]);
    await createService(
      makeConfig({ RAG_EVALUATION_DATASET: evaluationDataset }),
    );
    documents.findSimilar.mockResolvedValue([
      makeChunk(1, 0.95),
      makeChunk(2, 0.9),
      makeChunk(3, 0.85),
    ]);

    const [result] = await service.runRetrievalEvaluation(3);

    expect(result).toMatchObject({
      evaluationAvailable: true,
      expectedDocumentIds: [DOCUMENT_ID],
      expectedChunkIds: [2, 3],
      retrievedChunkIds: [1, 2, 3],
      foundExpectedDocument: true,
      foundExpectedChunk: true,
      recallAtK: 1,
      precisionAtK: 2 / 3,
      mrr: 0.5,
      hitRateAtK: 1,
    });
  });

  it("marks metrics unavailable when no evaluation ground truth is configured", async () => {
    const results = await service.runRetrievalEvaluation();

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      evaluationAvailable: false,
      recallAtK: null,
      precisionAtK: null,
      mrr: null,
      hitRateAtK: null,
    } satisfies Partial<RetrievalEvaluationResult>);
  });

  it("maps database failures to a safe NestJS service-unavailable response", async () => {
    documents.findSimilar.mockRejectedValue(
      new Error("database credentials and connection details"),
    );

    await expect(
      service.chat({ question: "What is the policy?" }),
    ).rejects.toMatchObject({
      status: 503,
      message: "Unable to search the available documents right now. Please try again.",
    });
    expect(gemini.generate).not.toHaveBeenCalled();
  });
});

describe("GeminiService retry and error handling", () => {
  const model = {
    embedContent: jest.fn(),
    generateContent: jest.fn(),
  };
  let modelGetter: jest.SpyInstance;

  function createGeminiService(): GeminiService {
    const service = new GeminiService(
      makeConfig({
        GEMINI_API_KEY: "test-api-key",
        GEMINI_MAX_RETRIES: 3,
        GEMINI_RETRY_BASE_DELAY_MS: 1,
        GEMINI_RETRY_MAX_DELAY_MS: 1,
        GEMINI_REQUEST_TIMEOUT_MS: 1000,
      }),
    );
    service.onModuleInit();
    return service;
  }

  beforeEach(() => {
    model.embedContent.mockReset();
    model.generateContent.mockReset();
    jest.spyOn(Math, "random").mockReturnValue(0);
    modelGetter = jest
      .spyOn(GoogleGenerativeAI.prototype, "getGenerativeModel")
      .mockReturnValue(
        model as unknown as ReturnType<
          GoogleGenerativeAI["getGenerativeModel"]
        >,
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("retries 503 embedding errors and uses the configured request timeout", async () => {
    model.embedContent
      .mockRejectedValueOnce(Object.assign(new Error("unavailable"), { status: 503 }))
      .mockResolvedValue({
        embedding: { values: Array.from({ length: 768 }, () => 0.01) },
      });

    const embedding = await createGeminiService().embed(
      "policy text",
      "RETRIEVAL_QUERY",
    );

    expect(embedding).toHaveLength(768);
    expect(model.embedContent).toHaveBeenCalledTimes(2);
    expect(modelGetter).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-embedding-001" }),
      { timeout: 1000 },
    );
  });

  it("retries a 429 generation response and returns the successful text", async () => {
    model.generateContent
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }))
      .mockResolvedValue({
        response: { text: () => "Grounded answer." },
      });

    await expect(
      createGeminiService().generate("answer from context"),
    ).resolves.toBe("Grounded answer.");
    expect(model.generateContent).toHaveBeenCalledTimes(2);
  });

  it("returns a safe 503 after exhausting retries for a temporary provider error", async () => {
    model.generateContent.mockRejectedValue(
      Object.assign(new Error("internal provider details"), { status: 503 }),
    );

    await expect(createGeminiService().generate("prompt")).rejects.toMatchObject({
      status: 503,
      message: "The AI service is temporarily unavailable. Please try again shortly.",
    });
    expect(model.generateContent).toHaveBeenCalledTimes(4);
  });

  it("does not retry permanent provider errors", async () => {
    model.generateContent.mockRejectedValue(
      Object.assign(new Error("invalid key"), { status: 400 }),
    );

    await expect(createGeminiService().generate("prompt")).rejects.toMatchObject({
      status: 502,
      message: "The AI service could not complete the request. Please try again.",
    });
    expect(model.generateContent).toHaveBeenCalledTimes(1);
  });

  it("returns a safe error for an empty Gemini response", async () => {
    model.generateContent.mockResolvedValue({
      response: { text: () => "" },
    });

    await expect(createGeminiService().generate("prompt")).rejects.toMatchObject({
      status: 502,
      message: "The AI service returned an empty response. Please try again.",
    });
  });
});

describe("ChatController API response", () => {
  let app: INestApplication;
  const chatService = {
    chat: jest.fn(),
  };

  @Module({
    controllers: [ChatController],
    providers: [{ provide: ChatService, useValue: chatService }],
  })
  class TestChatModule {}

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestChatModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("preserves the answer and sources response shape", async () => {
    chatService.chat.mockResolvedValue({
      answer: "Grounded answer.",
      sources: [],
    });

    await request(app.getHttpServer())
      .post("/api/chat")
      .send({ question: "What is supported?", topK: 3 })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ answer: "Grounded answer.", sources: [] });
      });
  });

  it("returns the standard safe NestJS error payload", async () => {
    chatService.chat.mockRejectedValue(
      new ServiceUnavailableException("The AI service is temporarily unavailable."),
    );

    await request(app.getHttpServer())
      .post("/api/chat")
      .send({ question: "What is supported?" })
      .expect(503)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          statusCode: 503,
          message: "The AI service is temporarily unavailable.",
          error: "Service Unavailable",
        });
      });
  });
});
