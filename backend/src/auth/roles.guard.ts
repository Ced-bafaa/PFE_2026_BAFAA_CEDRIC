import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';
import { Role, ROLE_LEVEL } from './roles.enum';

/**
 * Garde globale de rôle (s'exécute après JwtAuthGuard).
 * Lit le rôle minimum requis (@MinRole) sur la méthode puis la classe.
 * Sans contrainte → tout utilisateur authentifié passe.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Role | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<{ user?: { role?: Role } }>();
    const role = req.user?.role;
    if (role && ROLE_LEVEL[role] >= ROLE_LEVEL[required]) return true;
    throw new ForbiddenException('Droits insuffisants pour cette action.');
  }
}
