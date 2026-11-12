import { ConfigService } from "@nestjs/config";
import { CookieOptions } from "express";

export const REFRESH_COOKIE = "__Host-refresh";
export const CSRF_COOKIE = "__Host-csrf";

export function getAuthCookieOptions(
  config: ConfigService,
  maxAge: number,
  httpOnly: boolean,
): CookieOptions {
  const secure = config.get<string>("AUTH_COOKIE_SECURE", "true") === "true";
  const sameSite = config.get<"strict" | "lax" | "none">(
    "AUTH_COOKIE_SAME_SITE",
    process.env.NODE_ENV === "production" ? "none" : "lax",
  );

  if (!secure) {
    throw new Error("__Host authentication cookies require Secure.");
  }
  if (!["strict", "lax", "none"].includes(sameSite)) {
    throw new Error("AUTH_COOKIE_SAME_SITE must be strict, lax, or none.");
  }
  if (sameSite === "none" && !secure) {
    throw new Error("SameSite=None cookies require AUTH_COOKIE_SECURE=true.");
  }

  return {
    httpOnly,
    secure,
    sameSite,
    path: "/",
    maxAge,
  };
}
