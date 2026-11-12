import { ForbiddenException, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { INestApplication } from "@nestjs/common";
import request = require("supertest");
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { AdminGuard } from "../src/auth/guards/admin.guard";
import { JwtAuthGuard } from "../src/auth/guards/jwt-auth.guard";

const csrfToken = "1234567890.nonce.signature";

describe("AuthController cookies and CSRF", () => {
  let app: INestApplication;
  const authService = {
    getValidCsrfToken: jest.fn().mockReturnValue(csrfToken),
    assertCsrf: jest.fn(),
    login: jest.fn().mockResolvedValue({
      accessToken: "short-lived.jwt",
      refreshToken: "opaque-refresh-token",
      csrfToken,
      expiresIn: 600,
      admin: { id: 1, email: "admin@example.com", role: "ADMIN" },
    }),
    refresh: jest.fn(),
    logout: jest.fn(),
    refreshTtlSeconds: 604_800,
  };

  @Module({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }])],
    controllers: [AuthController],
    providers: [
      JwtAuthGuard,
      AdminGuard,
      { provide: AuthService, useValue: authService },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string, fallback: string) =>
            key === "AUTH_COOKIE_SECURE" ? "true" : key === "AUTH_COOKIE_SAME_SITE" ? "none" : fallback,
        },
      },
    ],
  })
  class TestAuthModule {}

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.use((request, _response, next) => {
      request.cookies = { "__Host-csrf": csrfToken };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    authService.assertCsrf.mockReset();
    authService.login.mockClear();
  });

  it("issues secure host-only CSRF cookies", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/auth/csrf")
      .expect(200);
    const cookieHeader = response.headers["set-cookie"];
    const cookies = Array.isArray(cookieHeader)
      ? cookieHeader
      : cookieHeader
        ? [cookieHeader]
        : [];
    expect(response.body.csrfToken).toBe(csrfToken);
    expect(cookies[0]).toContain("__Host-csrf=");
    expect(cookies[0]).toContain("Secure");
    expect(cookies[0]).toContain("SameSite=None");
    expect(cookies[0]).toContain("HttpOnly");
  });

  it("sets the HttpOnly refresh cookie and never returns its value", async () => {
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .set("Cookie", `__Host-csrf=${csrfToken}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ email: "admin@example.com", password: "correct-password" })
      .expect(200)
      .expect(({ body, headers }) => {
        expect(body).toMatchObject({
          accessToken: "short-lived.jwt",
          admin: { role: "ADMIN" },
        });
        expect(body.refreshToken).toBeUndefined();
        const cookieHeader = headers["set-cookie"];
        const cookies = Array.isArray(cookieHeader)
          ? cookieHeader
          : cookieHeader
            ? [cookieHeader]
            : [];
        const refreshCookie = cookies.find((cookie) =>
          cookie.startsWith("__Host-refresh="),
        );
        expect(refreshCookie).toContain("HttpOnly");
        expect(refreshCookie).toContain("Secure");
        expect(refreshCookie).toContain("SameSite=None");
      });
    expect(authService.login).toHaveBeenCalledWith(
      "admin@example.com",
      "correct-password",
    );
  });

  it("rejects login when CSRF validation fails", async () => {
    authService.assertCsrf.mockImplementation(() => {
      throw new ForbiddenException("Invalid CSRF token.");
    });
    await request(app.getHttpServer())
      .post("/api/auth/login")
      .set("Cookie", `__Host-csrf=${csrfToken}`)
      .set("X-CSRF-Token", "wrong-token")
      .send({ email: "admin@example.com", password: "correct-password" })
      .expect(403);
    expect(authService.login).not.toHaveBeenCalled();
  });
});
