import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from "@nestjs/common";
import { Request } from "express";
import { AdminPrincipal } from "../types/admin-principal";

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      Request & { user?: AdminPrincipal }
    >();

    if (request.user?.role !== "ADMIN") {
      throw new ForbiddenException("Administrator access required.");
    }

    return true;
  }
}
