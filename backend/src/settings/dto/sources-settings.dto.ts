import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';

export class SourceItemDto {
  @IsString()
  id: string;

  @IsString()
  title: string;

  @IsUrl({ require_tld: false })
  url: string;

  @IsBoolean()
  active: boolean;

  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @IsOptional()
  @IsIn(['rss', 'scrape'])
  collectionMode?: 'rss' | 'scrape';
}

export class SourcesSettingsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  globalKeywords?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SourceItemDto)
  sources: SourceItemDto[];

  /** Description textuelle de l'entreprise pour le filtrage sémantique. */
  @IsOptional()
  @IsString()
  companyDescription?: string;

  /** Domaines d'expertise de l'entreprise. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  companyDomains?: string[];
}
