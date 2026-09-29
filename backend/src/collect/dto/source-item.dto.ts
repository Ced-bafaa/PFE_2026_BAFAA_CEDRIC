import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';

export enum CollectionMode {
  RSS = 'rss',
  SCRAPE = 'scrape',
}

export class SourceItemDto {
  @IsString()
  id: string;

  @IsString()
  title: string;

  @IsUrl({ require_tld: false })
  url: string;

  @IsBoolean()
  active: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  /**
   * Si absent, déduit de l’URL (/feed, .xml, rss, atom…), sinon scraping HTML.
   */
  @IsOptional()
  @IsEnum(CollectionMode)
  collectionMode?: CollectionMode;
}

export class CollectPreviewDto {
  @ValidateNested()
  @Type(() => SourceItemDto)
  source: SourceItemDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  globalKeywords?: string[];
}

export class CollectBatchDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  globalKeywords?: string[];

  @IsOptional()
  @IsString()
  companyDescription?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SourceItemDto)
  sources: SourceItemDto[];
}
