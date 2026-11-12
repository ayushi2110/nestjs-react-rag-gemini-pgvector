import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthService } from "../auth.service";
import {
  AccessTokenPayload,
  AdminPrincipal,
} from "../types/admin-principal";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("AUTH_JWT_SECRET"),
      jsonWebTokenOptions: { issuer: "rag-app-admin" },
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AdminPrincipal> {
    const adminId = Number(payload.sub);
    if (
      !Number.isSafeInteger(adminId) ||
      adminId < 1 ||
      payload.role !== "ADMIN" ||
      !payload.sid
    ) {
      throw new UnauthorizedException("Invalid access token.");
    }

    const admin = await this.authService.validateAccessSession(
      payload.sid,
      adminId,
    );
    if (!admin) {
      throw new UnauthorizedException("Session is no longer active.");
    }

    return { ...admin, sessionId: payload.sid };
  }
}
