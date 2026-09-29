import { IsObject, IsOptional, IsString } from 'class-validator';

export class EnrichOpportunityDto {
  /**
   * Budget exact (ex: "125000000 FCFA" ou "125000000").
   * Optionnel: si fourni, remplace `budget`.
   */
  @IsOptional()
  @IsString()
  budget?: string;

  /**
   * Contact (mail/tel/nom) extrait.
   * Optionnel: stockage dans enrichment + peut enrichir description.
   */
  @IsOptional()
  @IsString()
  contact?: string;

  /**
   * Critères d'éligibilité / éliminatoires (texte).
   */
  @IsOptional()
  @IsString()
  eligibilityCriteria?: string;

  /**
   * Payload libre: tout JSON structuré issu de l'extracteur Python
   * (administratif/technique/financier, etc.)
   */
  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
}

