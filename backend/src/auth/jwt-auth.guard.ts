import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';
import { Role } from './roles.enum';

/**
 * Garde globale d'authentification.
 *  - Routes @Public() → laissées passer.
 *  - Clé d'API partagée (x-api-key == KIAMA_API_KEY) → accès machine-à-machine
 *    (extracteur, scripts) traité comme service de confiance.
 *  - Sinon → JWT « Bearer » obligatoire ; le payload est attaché à req.user.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: Record<string, unknown> }>();

    // Bypass service-à-service par clé d'API partagée (uniquement si configurée).
    const expectedKey = (process.env.KIAMA_API_KEY ?? '').trim();
    if (expectedKey && String(req.headers['x-api-key'] ?? '').trim() === expectedKey) {
      req.user = { sub: 'service', email: 'service@kiama', role: Role.ADMIN_SYSTEME, service: true };
      return true;
    }

    const header = String(req.headers['authorization'] ?? '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      throw new UnauthorizedException('Authentification requise.');
    }
    try {
      req.user = this.jwt.verify(token) as Record<string, unknown>;
      return true;
    } catch {
      throw new UnauthorizedException('Session invalide ou expirée.');
    }
  }
}
