import { ForbiddenException, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Pool } from "pg";
import * as argon2 from "argon2";
import { createHash } from "crypto";
import { AuthService } from "../src/auth/auth.service";

jest.mock("argon2", () => ({
  verify: jest.fn(),
  hash: jest.fn(),
  argon2id: 2,
}));

const mockedArgon2 = argon2 as jest.Mocked<typeof argon2>;

describe("AuthService", () => {
  const future = new Date(Date.now() + 60_000);
  let pool: { query: jest.Mock; connect: jest.Mock };
  let client: { query: jest.Mock; release: jest.Mock };
  let jwt: { signAsync: jest.Mock };
  let config: {
    get: jest.Mock;
    getOrThrow: jest.Mock;
  };
  let service: AuthService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    mockedArgon2.verify.mockReset();
    mockedArgon2.hash.mockReset();
    mockedArgon2.hash.mockResolvedValue("dummy-password-hash");
    client = { query: jest.fn(), release: jest.fn() };
    pool = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue(client),
    };
    jwt = { signAsync: jest.fn().mockResolvedValue("access.jwt") };
    config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
      getOrThrow: jest.fn((key: string) =>
        key === "AUTH_CSRF_SECRET" ? "c".repeat(48) : "",
      ),
    };
    service = new AuthService(
      pool as unknown as Pool,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
    );
    mockedArgon2.hash.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("authenticates the provisioned admin and stores only a refresh-token hash", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, email: "admin@example.com", role: "ADMIN", password_hash: "argon-hash" }],
    });
    mockedArgon2.verify.mockResolvedValue(true);

    const result = await service.login("ADMIN@example.com", "correct-password");

    expect(result.admin).toEqual({
      id: 1,
      email: "admin@example.com",
      role: "ADMIN",
    });
    expect(result.accessToken).toBe("access.jwt");
    const insertedToken = client.query.mock.calls.find(([query]) =>
      String(query).includes("INSERT INTO admin_refresh_tokens"),
    );
    expect(insertedToken?.[1][1]).toBe(
      createHash("sha256").update(result.refreshToken).digest("hex"),
    );
    expect(insertedToken?.[1][1]).not.toBe(result.refreshToken);
  });

  it("rejects unknown admins and incorrect passwords with the same response", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    mockedArgon2.verify.mockResolvedValue(false);
    await expect(service.login("missing@example.com", "wrong")).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockedArgon2.verify).toHaveBeenCalledWith(
      "dummy-password-hash",
      "wrong",
    );

    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, email: "admin@example.com", role: "ADMIN", password_hash: "argon-hash" }],
    });
    mockedArgon2.verify.mockResolvedValue(false);
    await expect(service.login("admin@example.com", "wrong")).rejects.toThrow(
      "Invalid email or password.",
    );
  });

  it("rotates refresh tokens and rejects replay by revoking the session", async () => {
    const sessionId = "2eb46ee3-7d24-471f-866c-20f1afc5da97";
    client.query.mockResolvedValueOnce({ rows: [] });
    client.query.mockResolvedValueOnce({
      rows: [{
        token_id: 17,
        session_id: sessionId,
        token_expires_at: future,
        consumed_at: null,
        admin_id: 1,
        session_expires_at: future,
        revoked_at: null,
        email: "admin@example.com",
        role: "ADMIN",
      }],
    });
    client.query.mockResolvedValue({ rows: [] });

    const rotated = await service.refresh("old-refresh-token");

    expect(rotated.refreshToken).not.toBe("old-refresh-token");
    expect(client.query).toHaveBeenCalledWith(
      "UPDATE admin_refresh_tokens SET consumed_at = NOW() WHERE id = $1",
      [17],
    );
    const insertedToken = client.query.mock.calls.find(([query]) =>
      String(query).includes("INSERT INTO admin_refresh_tokens"),
    );
    expect(insertedToken?.[1][1]).toBe(
      createHash("sha256").update(rotated.refreshToken).digest("hex"),
    );

    client.query.mockReset();
    client.query.mockResolvedValueOnce({ rows: [] });
    client.query.mockResolvedValueOnce({
      rows: [{
        token_id: 17,
        session_id: sessionId,
        token_expires_at: future,
        consumed_at: new Date(),
        admin_id: 1,
        session_expires_at: future,
        revoked_at: null,
        email: "admin@example.com",
        role: "ADMIN",
      }],
    });
    client.query.mockResolvedValue({ rows: [] });

    await expect(service.refresh("old-refresh-token")).rejects.toThrow(
      "Refresh token reuse detected.",
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE admin_sessions"),
      [sessionId],
    );
  });

  it("revokes the current session on logout", async () => {
    await service.logout("refresh-token");
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE admin_sessions"),
      [createHash("sha256").update("refresh-token").digest("hex")],
    );
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(
      service.validateAccessSession("2eb46ee3-7d24-471f-866c-20f1afc5da97", 1),
    ).resolves.toBeNull();
  });

  it("rejects inactive access-token sessions", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(
      service.validateAccessSession("2eb46ee3-7d24-471f-866c-20f1afc5da97", 1),
    ).resolves.toBeNull();
  });

  it("refuses to provision an additional admin", async () => {
    config.getOrThrow.mockImplementation((key: string) => {
      if (key === "AUTH_CSRF_SECRET") return "c".repeat(48);
      if (key === "ADMIN_BOOTSTRAP_EMAIL") return "admin@example.com";
      if (key === "ADMIN_BOOTSTRAP_PASSWORD") return "correct-password";
      throw new Error(`Unexpected config ${key}`);
    });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    await expect(service.provisionInitialAdmin()).rejects.toThrow(
      "An administrator already exists",
    );
    expect(mockedArgon2.hash).not.toHaveBeenCalled();
  });

  it("rejects expired refresh tokens", async () => {
    client.query.mockResolvedValueOnce({ rows: [] });
    client.query.mockResolvedValueOnce({
      rows: [{
        token_id: 18,
        session_id: "2eb46ee3-7d24-471f-866c-20f1afc5da97",
        token_expires_at: new Date(Date.now() - 1_000),
        consumed_at: null,
        admin_id: 1,
        session_expires_at: future,
        revoked_at: null,
        email: "admin@example.com",
        role: "ADMIN",
      }],
    });
    client.query.mockResolvedValue({ rows: [] });

    await expect(service.refresh("expired-refresh-token")).rejects.toThrow(
      UnauthorizedException,
    );
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("accepts a valid CSRF token and rejects a mismatch", () => {
    const token = service.createCsrfToken();
    expect(() => service.assertCsrf(token, token)).not.toThrow();
    expect(() => service.assertCsrf(token, "forged-token")).toThrow(
      ForbiddenException,
    );
  });

  it("relies on the singleton database constraint for concurrent provisioning", async () => {
    config.getOrThrow.mockImplementation((key: string) => {
      if (key === "AUTH_CSRF_SECRET") return "c".repeat(48);
      if (key === "ADMIN_BOOTSTRAP_EMAIL") return "admin@example.com";
      if (key === "ADMIN_BOOTSTRAP_PASSWORD") return "correct-password";
      throw new Error(`Unexpected config ${key}`);
    });
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce({ code: "23505" });
    mockedArgon2.hash.mockResolvedValue("argon2id-hash");

    await expect(service.provisionInitialAdmin()).rejects.toMatchObject({
      code: "23505",
    });
    expect(pool.query.mock.calls[1][0]).toContain("VALUES (1, $1, $2, 'ADMIN')");
  });
});
