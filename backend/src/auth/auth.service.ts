import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { isEmail } from "class-validator";
import { Pool } from "pg";
import * as argon2 from "argon2";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "crypto";
import { DATABASE_POOL } from "../common/database.module";
import {
  AccessTokenPayload,
  AdminProfile,
} from "./types/admin-principal";

interface AdminRow {
  id: number;
  email: string;
  role: "ADMIN";
  password_hash?: string;
}

interface SessionAuthResult {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  expiresIn: number;
  admin: AdminProfile;
}

interface RefreshTokenRow {
  token_id: number;
  session_id: string;
  token_expires_at: Date;
  consumed_at: Date | null;
  admin_id: number;
  session_expires_at: Date;
  revoked_at: Date | null;
  email: string;
  role: "ADMIN";
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
  private readonly csrfSecret: string;
  private readonly dummyPasswordHash: Promise<string>;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.accessTtlSeconds = this.readPositiveInteger(
      "AUTH_ACCESS_TTL_SECONDS",
      600,
      60 * 60,
    );
    this.refreshTtlSeconds = this.readPositiveInteger(
      "AUTH_REFRESH_TTL_SECONDS",
      7 * 24 * 60 * 60,
      30 * 24 * 60 * 60,
    );
    this.csrfSecret = config.getOrThrow<string>("AUTH_CSRF_SECRET");
    if (this.csrfSecret.length < 32) {
      throw new Error("AUTH_CSRF_SECRET must be at least 32 characters.");
    }
    this.dummyPasswordHash = argon2.hash(
      randomBytes(32).toString("base64url"),
      { type: argon2.argon2id },
    );
  }

  async login(email: string, password: string): Promise<SessionAuthResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const { rows } = await this.pool.query<AdminRow>(
      `SELECT id, email, role, password_hash
       FROM admin_accounts
       WHERE email = $1`,
      [normalizedEmail],
    );
    const admin = rows[0];

    const storedHash = admin?.password_hash ?? (await this.dummyPasswordHash);
    const validPassword = await argon2.verify(storedHash, password);
    if (!admin || !validPassword || admin.role !== "ADMIN") {
      throw new UnauthorizedException("Invalid email or password.");
    }

    return this.createSession(admin);
  }

  async refresh(rawToken: string): Promise<SessionAuthResult> {
    const tokenHash = this.hashToken(rawToken);
    const nextRefreshToken = this.createOpaqueToken();
    const nextTokenHash = this.hashToken(nextRefreshToken);
    const nextCsrfToken = this.createCsrfToken();
    const client = await this.pool.connect();
    let replayDetected = false;
    let sessionAdmin: AdminProfile | undefined;
    let sessionId: string | undefined;

    try {
      await client.query("BEGIN");
      const { rows } = await client.query<RefreshTokenRow>(
        `SELECT
           token.id AS token_id,
           token.session_id,
           token.expires_at AS token_expires_at,
           token.consumed_at,
           session.admin_id,
           session.expires_at AS session_expires_at,
           session.revoked_at,
           admin.email,
           admin.role
         FROM admin_refresh_tokens token
         JOIN admin_sessions session ON session.id = token.session_id
         JOIN admin_accounts admin ON admin.id = session.admin_id
         WHERE token.token_hash = $1
         FOR UPDATE OF token, session`,
        [tokenHash],
      );
      const current = rows[0];

      if (!current) {
        throw new UnauthorizedException("Invalid or expired refresh token.");
      }

      sessionId = current.session_id;
      sessionAdmin = {
        id: current.admin_id,
        email: current.email,
        role: current.role,
      };

      if (current.consumed_at) {
        replayDetected = true;
        await client.query(
          `UPDATE admin_sessions
           SET revoked_at = COALESCE(revoked_at, NOW())
           WHERE id = $1`,
          [current.session_id],
        );
        await client.query("COMMIT");
      } else if (
        current.revoked_at ||
        new Date(current.token_expires_at).getTime() <= Date.now() ||
        new Date(current.session_expires_at).getTime() <= Date.now()
      ) {
        throw new UnauthorizedException("Invalid or expired refresh token.");
      } else {
        const nextTokenExpiry = new Date(
          Math.min(
            Date.now() + this.refreshTtlSeconds * 1000,
            new Date(current.session_expires_at).getTime(),
          ),
        );

        await client.query(
          "UPDATE admin_refresh_tokens SET consumed_at = NOW() WHERE id = $1",
          [current.token_id],
        );
        await client.query(
          `INSERT INTO admin_refresh_tokens (session_id, token_hash, expires_at)
           VALUES ($1, $2, $3)`,
          [current.session_id, nextTokenHash, nextTokenExpiry],
        );
        await client.query(
          "UPDATE admin_sessions SET last_used_at = NOW() WHERE id = $1",
          [current.session_id],
        );
        await client.query("COMMIT");
      }
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        this.logger.error("Failed to roll back refresh-token rotation.");
      }
      throw error;
    } finally {
      client.release();
    }

    if (replayDetected) {
      throw new UnauthorizedException("Refresh token reuse detected.");
    }
    if (!sessionId || !sessionAdmin) {
      throw new UnauthorizedException("Invalid refresh session.");
    }

    return {
      accessToken: await this.signAccessToken(sessionAdmin, sessionId),
      refreshToken: nextRefreshToken,
      csrfToken: nextCsrfToken,
      expiresIn: this.accessTtlSeconds,
      admin: sessionAdmin,
    };
  }

  async logout(rawToken?: string): Promise<void> {
    if (!rawToken) return;

    await this.pool.query(
      `UPDATE admin_sessions
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE id = (
         SELECT session_id
         FROM admin_refresh_tokens
         WHERE token_hash = $1
       )`,
      [this.hashToken(rawToken)],
    );
  }

  async validateAccessSession(
    sessionId: string,
    adminId: number,
  ): Promise<AdminProfile | null> {
    const { rows } = await this.pool.query<AdminRow>(
      `SELECT admin.id, admin.email, admin.role
       FROM admin_sessions session
       JOIN admin_accounts admin ON admin.id = session.admin_id
       WHERE session.id = $1
         AND admin.id = $2
         AND session.revoked_at IS NULL
         AND session.expires_at > NOW()`,
      [sessionId, adminId],
    );
    const admin = rows[0];

    return admin && admin.role === "ADMIN"
      ? { id: admin.id, email: admin.email, role: "ADMIN" }
      : null;
  }

  createCsrfToken(): string {
    const issuedAt = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(32).toString("base64url");
    const message = `${issuedAt}.${nonce}`;
    const signature = createHmac("sha256", this.csrfSecret)
      .update(message)
      .digest("base64url");
    return `${message}.${signature}`;
  }

  getValidCsrfToken(cookieToken?: string): string {
    if (cookieToken && this.isValidCsrfToken(cookieToken)) return cookieToken;
    return this.createCsrfToken();
  }

  assertCsrf(cookieToken?: string, headerToken?: string): void {
    if (
      !cookieToken ||
      !headerToken ||
      !this.safeEqual(cookieToken, headerToken) ||
      !this.isValidCsrfToken(cookieToken)
    ) {
      throw new ForbiddenException("Invalid CSRF token.");
    }
  }

  async provisionInitialAdmin(): Promise<void> {
    const email = this.config.getOrThrow<string>("ADMIN_BOOTSTRAP_EMAIL")
      .trim()
      .toLowerCase();
    const password = this.config.getOrThrow<string>("ADMIN_BOOTSTRAP_PASSWORD");

    if (!isEmail(email)) {
      throw new Error("ADMIN_BOOTSTRAP_EMAIL must be a valid email address.");
    }
    if (password.length < 12 || password.length > 128) {
      throw new Error("ADMIN_BOOTSTRAP_PASSWORD must be 12-128 characters.");
    }

    const { rows } = await this.pool.query<{ id: number }>(
      "SELECT id FROM admin_accounts LIMIT 1",
    );
    if (rows.length > 0) {
      throw new Error(
        "An administrator already exists; the bootstrap command will not overwrite it.",
      );
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });

    try {
      await this.pool.query(
        `INSERT INTO admin_accounts (id, email, password_hash, role)
         VALUES (1, $1, $2, 'ADMIN')`,
        [email, passwordHash],
      );
      this.logger.log("Initial administrator provisioned.");
    } catch (error) {
      this.logger.error("Initial administrator provisioning failed.");
      throw error;
    }
  }

  private async createSession(admin: AdminRow): Promise<SessionAuthResult> {
    const sessionId = randomUUID();
    const refreshToken = this.createOpaqueToken();
    const csrfToken = this.createCsrfToken();
    const expiresAt = new Date(
      Date.now() + this.refreshTtlSeconds * 1000,
    );
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM admin_sessions WHERE expires_at <= NOW()");
      await client.query(
        `INSERT INTO admin_sessions (id, admin_id, expires_at)
         VALUES ($1, $2, $3)`,
        [sessionId, admin.id, expiresAt],
      );
      await client.query(
        `INSERT INTO admin_refresh_tokens (session_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [sessionId, this.hashToken(refreshToken), expiresAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        this.logger.error("Failed to roll back administrator session creation.");
      }
      throw error;
    } finally {
      client.release();
    }

    const profile: AdminProfile = {
      id: admin.id,
      email: admin.email,
      role: "ADMIN",
    };

    return {
      accessToken: await this.signAccessToken(profile, sessionId),
      refreshToken,
      csrfToken,
      expiresIn: this.accessTtlSeconds,
      admin: profile,
    };
  }

  private async signAccessToken(
    admin: AdminProfile,
    sessionId: string,
  ): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: String(admin.id),
      sid: sessionId,
      role: admin.role,
      email: admin.email,
      jti: randomUUID(),
    };
    return this.jwt.signAsync(payload, {
      expiresIn: this.accessTtlSeconds,
    });
  }

  private createOpaqueToken(): string {
    return randomBytes(32).toString("base64url");
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private isValidCsrfToken(token: string): boolean {
    const [issuedAtRaw, nonce, signature, ...rest] = token.split(".");
    if (!issuedAtRaw || !nonce || !signature || rest.length > 0) return false;

    const issuedAt = Number(issuedAtRaw);
    const now = Math.floor(Date.now() / 1000);
    if (
      !Number.isSafeInteger(issuedAt) ||
      issuedAt > now + 60 ||
      now - issuedAt > 24 * 60 * 60
    ) {
      return false;
    }

    const expected = createHmac("sha256", this.csrfSecret)
      .update(`${issuedAtRaw}.${nonce}`)
      .digest("base64url");
    return this.safeEqual(signature, expected);
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private readPositiveInteger(
    name: string,
    fallback: number,
    maximum: number,
  ): number {
    const value = Number(this.config.get<string>(name, String(fallback)));
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
      throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
    }
    return value;
  }
}
