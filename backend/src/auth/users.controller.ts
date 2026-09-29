import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { MinRole } from './roles.decorator';
import { Role } from './roles.enum';

type ReqUser = { sub?: string; email?: string };

/**
 * Gestion des comptes — réservée à l'admin système (@MinRole au niveau classe).
 * Chaque action sensible est journalisée (acteur = admin issu du JWT).
 */
@Controller('users')
@MinRole(Role.ADMIN_SYSTEME)
export class UsersController {
  constructor(
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  private actor(req: Request & { user?: ReqUser }): string {
    return req.user?.email || req.user?.sub || 'inconnu';
  }

  @Get()
  list() {
    return this.auth.listUsers();
  }

  @Post()
  async create(
    @Body()
    body: { firstName?: string; lastName?: string; position?: string; email?: string; role?: string },
    @Req() req: Request & { user?: ReqUser },
  ) {
    const res = await this.auth.createUser(body);
    void this.audit
      .add(
        {
          action: 'user_created',
          entityType: 'user',
          entityId: res.user.id,
          details: `${res.user.email} (${res.user.role})`,
        },
        this.actor(req),
        req.user?.sub,
      )
      .catch(() => undefined);
    return res;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: { firstName?: string; lastName?: string; position?: string; role?: string; active?: boolean },
    @Req() req: Request & { user?: ReqUser },
  ) {
    const res = await this.auth.updateUser(id, body, req.user?.sub);
    const parts: string[] = [];
    if (typeof body.role === 'string') parts.push(`rôle → ${body.role}`);
    if (body.active === false) parts.push('désactivé');
    if (body.active === true) parts.push('réactivé');
    if (typeof body.firstName === 'string' || typeof body.lastName === 'string') parts.push('identité modifiée');
    if (typeof body.position === 'string') parts.push('poste modifié');
    void this.audit
      .add(
        {
          action: 'user_updated',
          entityType: 'user',
          entityId: id,
          details: `${res.email} — ${parts.join(', ') || 'mise à jour'}`,
        },
        this.actor(req),
        req.user?.sub,
      )
      .catch(() => undefined);
    return res;
  }

  @Post(':id/reset-password')
  async resetPassword(@Param('id') id: string, @Req() req: Request & { user?: ReqUser }) {
    const res = await this.auth.resetPassword(id);
    void this.audit
      .add(
        { action: 'user_password_reset', entityType: 'user', entityId: id },
        this.actor(req),
        req.user?.sub,
      )
      .catch(() => undefined);
    return res;
  }
}
