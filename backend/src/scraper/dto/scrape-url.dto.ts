import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

export class ScrapeUrlDto {
  @IsString()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  url!: string;

  /**
   * Si `true` : une seule stratégie de scraping (la première), réponse immédiate même vide.
   * Si `false` ou absent : enchaîne les stratégies jusqu’à obtenir des opportunités.
   */
  @ApiPropertyOptional({
    description:
      'Mode direct : arrêt après la première stratégie (sans fallback Playwright/Generic).',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  directScrape?: boolean;

  @ApiPropertyOptional({
    description:
      "Liste de mots-clés : ne conserve que les offres dont le titre contient l'un des mots-clés (case-insensitive).",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}

