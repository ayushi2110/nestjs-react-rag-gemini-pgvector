import { Module, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import request = require("supertest");
import { AuthService } from "../src/auth/auth.service";
import { AdminGuard } from "../src/auth/guards/admin.guard";
import { JwtAuthGuard } from "../src/auth/guards/jwt-auth.guard";
import { JwtStrategy } from "../src/auth/strategies/jwt.strategy";
import { DocumentsController } from "../src/documents/documents.controller";
import { DocumentsService } from "../src/documents/documents.service";

const JWT_SECRET = "test-jwt-secret-that-is-at-least-32-characters";
const SESSION_ID = "2eb46ee3-7d24-471f-866c-20f1afc5da97";

describe("DocumentsController admin authorization", () => {
  let app: INestApplication;
  let jwt: JwtService;
  const authService = {
    validateAccessSession: jest.fn(),
  };
  const documentsService = {
    ingestText: jest.fn(),
    ingestBuffer: jest.fn(),
    getStats: jest.fn(),
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    deleteDocument: jest.fn(),
  };

  @Module({
    imports: [
      PassportModule,
      JwtModule.register({
        secret: JWT_SECRET,
        signOptions: { issuer: "rag-app-admin" },
      }),
    ],
    controllers: [DocumentsController],
    providers: [
      JwtStrategy,
      JwtAuthGuard,
      AdminGuard,
      { provide: AuthService, useValue: authService },
      { provide: DocumentsService, useValue: documentsService },
      {
        provide: ConfigService,
        useValue: { getOrThrow: () => JWT_SECRET },
      },
      { provide: "DATABASE_POOL", useValue: {} as Pool },
    ],
  })
  class TestDocumentsModule {}

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestDocumentsModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  beforeEach(() => {
    authService.validateAccessSession.mockResolvedValue({
      id: 1,
      email: "admin@example.com",
      role: "ADMIN",
    });
    documentsService.ingestBuffer.mockResolvedValue({
      documentId: "2eb46ee3-7d24-471f-866c-20f1afc5da97",
      title: "notes",
      chunksStored: 1,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function accessToken(expiresIn: number | string = "5m") {
    return jwt.signAsync(
      {
        sub: "1",
        sid: SESSION_ID,
        role: "ADMIN",
        email: "admin@example.com",
        jti: "test-jti",
      },
      { expiresIn },
    );
  }

  it("rejects document upload without authentication", async () => {
    await request(app.getHttpServer())
      .post("/api/documents/upload")
      .expect(401);
    expect(documentsService.ingestBuffer).not.toHaveBeenCalled();
  });

  it("rejects expired access tokens", async () => {
    const token = await accessToken(-1);
    await request(app.getHttpServer())
      .post("/api/documents/upload")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
    expect(authService.validateAccessSession).not.toHaveBeenCalled();
  });

  it("allows an authenticated admin to upload a document", async () => {
    const token = await accessToken();
    await request(app.getHttpServer())
      .post("/api/documents/upload")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from("admin uploaded content"), {
        filename: "notes.txt",
        contentType: "text/plain",
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          success: true,
          title: "notes",
          chunksStored: 1,
        });
      });
    expect(documentsService.ingestBuffer).toHaveBeenCalled();
  });
});
