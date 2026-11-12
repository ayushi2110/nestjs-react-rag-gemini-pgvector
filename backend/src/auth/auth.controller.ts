import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { Request, Response } from "express";
import { AdminLoginDto } from "./dto/admin-login.dto";
import { AuthService } from "./auth.service";
import { CSRF_COOKIE, getAuthCookieOptions, REFRESH_COOKIE } from "./auth-cookies";
import { AdminGuard } from "./guards/admin.guard";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { AdminPrincipal } from "./types/admin-principal";

interface AuthenticatedRequest extends Request {
  user: AdminPrincipal;
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Get("csrf")
  csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const token = this.authService.getValidCsrfToken(
      request.cookies?.[CSRF_COOKIE],
    );
    response.cookie(
      CSRF_COOKIE,
      token,
      getAuthCookieOptions(this.config, 24 * 60 * 60 * 1000, true),
    );
    return { csrfToken: token };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: AdminLoginDto,
    @Req() request: Request,
    @Headers("x-csrf-token") csrfHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.authService.assertCsrf(
      request.cookies?.[CSRF_COOKIE],
      csrfHeader,
    );
    const auth = await this.authService.login(dto.email, dto.password);
    this.setSessionCookies(response, auth.refreshToken, auth.csrfToken);

    return {
      accessToken: auth.accessToken,
      tokenType: "Bearer",
      expiresIn: auth.expiresIn,
      admin: auth.admin,
      csrfToken: auth.csrfToken,
    };
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Headers("x-csrf-token") csrfHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.authService.assertCsrf(
      request.cookies?.[CSRF_COOKIE],
      csrfHeader,
    );
    const refreshToken = request.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) {
      response.clearCookie(
        REFRESH_COOKIE,
        getAuthCookieOptions(this.config, 0, true),
      );
      throw new UnauthorizedException("Invalid or expired refresh token.");
    }

    try {
      const auth = await this.authService.refresh(refreshToken);
      this.setSessionCookies(response, auth.refreshToken, auth.csrfToken);
      return {
        accessToken: auth.accessToken,
        tokenType: "Bearer",
        expiresIn: auth.expiresIn,
        admin: auth.admin,
        csrfToken: auth.csrfToken,
      };
    } catch (error) {
      response.clearCookie(
        REFRESH_COOKIE,
        getAuthCookieOptions(this.config, 0, true),
      );
      throw error;
    }
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Headers("x-csrf-token") csrfHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.authService.assertCsrf(
      request.cookies?.[CSRF_COOKIE],
      csrfHeader,
    );
    await this.authService.logout(request.cookies?.[REFRESH_COOKIE]);
    response.clearCookie(
      REFRESH_COOKIE,
      getAuthCookieOptions(this.config, 0, true),
    );
    response.clearCookie(
      CSRF_COOKIE,
      getAuthCookieOptions(this.config, 0, true),
    );
  }

  @Get("me")
  @UseGuards(JwtAuthGuard, AdminGuard)
  me(@Req() request: AuthenticatedRequest) {
    const { id, email, role } = request.user;
    return { id, email, role };
  }

  private setSessionCookies(
    response: Response,
    refreshToken: string,
    csrfToken: string,
  ): void {
    response.cookie(
      REFRESH_COOKIE,
      refreshToken,
      getAuthCookieOptions(
        this.config,
        this.authService.refreshTtlSeconds * 1000,
        true,
      ),
    );
    response.cookie(
      CSRF_COOKIE,
      csrfToken,
      getAuthCookieOptions(this.config, 24 * 60 * 60 * 1000, true),
    );
  }
}
