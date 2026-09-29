import { Body, Controller, Get, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AddAuditLogDto } from './dto/add-audit-log.dto';
import type { LogsSettings, ListAuditLogsQuery } from './audit.types';
import { AuditService } from './audit.service';

@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('audit-logs')
  list(@Query() query: ListAuditLogsQuery) {
    return this.audit.list(query);
  }

  @Post('audit-logs')
  add(
    @Body() dto: AddAuditLogDto,
    @Req() req: Request & { user?: { email?: string; name?: string; sub?: string } },
  ) {
    // L'acteur est déterminé par le JWT (source de confiance), jamais par le
    // client : impossible d'usurper l'identité dans le journal d'audit.
    const u = req.user;
    const actor = u?.email || u?.name || u?.sub || undefined;
    return this.audit.add(dto, actor, u?.sub);
  }

  @Get('settings/logs')
  getSettings() {
    return this.audit.getSettings();
  }

  @Put('settings/logs')
  setSettings(@Body() dto: LogsSettings) {
    return this.audit.setSettings(dto);
  }
}
