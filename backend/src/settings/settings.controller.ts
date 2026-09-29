import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { SourcesSettingsDto } from './dto/sources-settings.dto';
import { CompanyProfileDto } from './dto/company-profile.dto';
import { SettingsService } from './settings.service';
import { AuditService } from '../audit/audit.service';
import { MinRole } from '../auth/roles.decorator';
import { Role } from '../auth/roles.enum';

type ReqUser = { sub?: string; email?: string };

const cvStorage = diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'cv');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const diplomaStorage = diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'diplomas');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

@Controller('settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private auditLog(
    req: Request & { user?: ReqUser },
    action: string,
    details?: string,
  ): void {
    const actor = req.user?.email || req.user?.sub || 'inconnu';
    void this.audit
      .add({ action, entityType: 'company', details }, actor, req.user?.sub)
      .catch(() => undefined);
  }

  @Get('sources')
  async getSources() {
    const cfg = await this.settings.getSourcesSettings();
    const path =
      typeof (this.settings as any)?.getSourcesSettingsPath === 'function'
        ? (this.settings as any).getSourcesSettingsPath()
        : '(unknown settings path)';
    const sources = Array.isArray((cfg as any)?.sources) ? ((cfg as any).sources as any[]) : [];
    const active = sources.filter((s) => s?.active === true);
    const globalKeywords = Array.isArray((cfg as any)?.globalKeywords) ? (cfg as any).globalKeywords : [];
    const sample = active.slice(0, 5).map((s) => ({
      id: s?.id,
      active: s?.active,
      keywordsCount: Array.isArray(s?.keywords) ? s.keywords.length : 0,
    }));
    this.logger.debug(
      `GET /settings/sources path=${path} globalKeywords=${globalKeywords.length} activeSources=${active.length} sample=${JSON.stringify(sample)}`,
    );
    return cfg;
  }

  @Put('sources')
  @MinRole(Role.ADMIN_SYSTEME)
  setSources(@Body() dto: SourcesSettingsDto) {
    this.logger.debug(
      `PUT /settings/sources globalKeywords=${(dto.globalKeywords?.length ?? 0)} sources=${(dto.sources ?? []).length}`,
    );
    const sample = (dto.sources ?? [])
      .slice(0, 5)
      .map((s) => ({
        id: s.id,
        active: s.active,
        keywordsCount: (s.keywords ?? []).length,
      }));
    this.logger.debug(`PUT /settings/sources sample=${JSON.stringify(sample)}`);
    return this.settings.setSourcesSettings({ ...dto, globalKeywords: dto.globalKeywords ?? [] });
  }

  @Get('company')
  async getCompany() {
    this.logger.debug('GET /settings/company');
    return this.settings.getCompanyProfile();
  }

  @Put('company')
  @MinRole(Role.ADMIN_SYSTEME)
  async setCompany(@Body() dto: CompanyProfileDto, @Req() req: Request & { user?: ReqUser }) {
    this.logger.debug(`PUT /settings/company company=${dto.company_name ?? '-'}`);
    const result = await this.settings.setCompanyProfile(dto as unknown as Record<string, unknown>);
    this.auditLog(req, 'company_profile_updated', 'Profil entreprise / personnel mis à jour');
    return result;
  }

  @Post('company/upload-diploma')
  @MinRole(Role.ADMIN_SYSTEME)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diplomaStorage,
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const ok = /\.(pdf|jpe?g|png)$/i.test(file.originalname);
        cb(ok ? null : new BadRequestException('Formats acceptés : PDF, JPG, PNG'), ok);
      },
    }),
  )
  async uploadDiploma(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request & { user?: ReqUser },
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu');
    this.logger.debug(`POST /settings/company/upload-diploma filename=${file.filename}`);
    this.auditLog(req, 'diploma_uploaded', file.originalname);
    return { filename: file.filename, originalname: file.originalname };
  }

  @Delete('company/diploma/:filename')
  @MinRole(Role.ADMIN_SYSTEME)
  async deleteDiploma(
    @Param('filename') filename: string,
    @Req() req: Request & { user?: ReqUser },
  ) {
    const filePath = path.join(process.cwd(), 'uploads', 'diplomas', path.basename(filename));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.logger.debug(`DELETE /settings/company/diploma/${filename} — supprimé`);
    }
    this.auditLog(req, 'diploma_deleted', filename);
    return { deleted: true };
  }

  @Post('company/upload-cv')
  @MinRole(Role.ADMIN_SYSTEME)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: cvStorage,
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Seuls les fichiers PDF sont acceptés'), false);
        }
      },
    }),
  )
  async uploadCv(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request & { user?: ReqUser },
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu');
    this.logger.debug(`POST /settings/company/upload-cv filename=${file.filename}`);
    this.auditLog(req, 'cv_uploaded', file.originalname);
    return { filename: file.filename, originalname: file.originalname };
  }

  @Delete('company/cv/:filename')
  @MinRole(Role.ADMIN_SYSTEME)
  async deleteCv(
    @Param('filename') filename: string,
    @Req() req: Request & { user?: ReqUser },
  ) {
    const filePath = path.join(process.cwd(), 'uploads', 'cv', filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.logger.debug(`DELETE /settings/company/cv/${filename} supprime`);
    }
    this.auditLog(req, 'cv_deleted', filename);
    return { deleted: true };
  }
}
