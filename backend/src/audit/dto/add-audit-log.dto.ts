import { IsOptional, IsString } from 'class-validator';

export class AddAuditLogDto {
  @IsString()
  action: string;

  @IsString()
  entityType: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsString()
  actor?: string;
}
