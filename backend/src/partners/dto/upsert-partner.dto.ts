import { IsOptional, IsString } from 'class-validator';
import { CompanyProfileDto } from '../../settings/dto/company-profile.dto';

/**
 * Un partenaire est décrit comme l'entreprise : le DTO hérite donc de tous les
 * champs du profil entreprise (identité, finances, compétences, personnel,
 * projets…) et n'ajoute que l'identifiant. Symétrie totale Entreprise ⇄ Partenaire.
 */
export class UpsertPartnerDto extends CompanyProfileDto {
  @IsOptional()
  @IsString()
  id?: string;
}
