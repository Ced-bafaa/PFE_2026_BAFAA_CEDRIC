import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CertificationDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  issuer?: string;

  @IsOptional()
  @IsString()
  year?: string;

  @IsOptional()
  @IsString()
  valid_until?: string;

  @IsOptional()
  @IsString()
  scope?: string;
}

export class CompetencyDto {
  @IsString()
  domain: string;

  @IsArray()
  @IsString({ each: true })
  keywords: string[];

  @IsOptional()
  @IsString()
  level?: string;
}

export class DiplomaFileDto {
  @IsString()
  filename: string;

  @IsString()
  originalname: string;
}

export class PersonnelDiplomaDto {
  @IsString()
  degree: string;

  @IsString()
  field: string;

  @IsOptional()
  @IsNumber()
  years_experience?: number;

  /** Scan du diplôme (PDF/image) téléversé — preuve jointe aux dossiers de soumission. */
  @IsOptional()
  @ValidateNested()
  @Type(() => DiplomaFileDto)
  file?: DiplomaFileDto;
}

export class PersonnelCvDto {
  @IsString()
  filename: string;

  @IsString()
  originalname: string;

  @IsOptional()
  @IsString()
  uploaded_at?: string;
}

export class PersonnelDto {
  @IsString()
  name: string;

  @IsString()
  role: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  certifications?: string[];

  @IsOptional()
  @IsNumber()
  years_experience?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsString()
  education?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonnelDiplomaDto)
  diplomas?: PersonnelDiplomaDto[];

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  availability?: string;

  @IsOptional()
  @IsNumber()
  daily_rate_fcfa?: number;

  @IsOptional()
  @IsNumber()
  projects_count?: number;

  @IsOptional()
  @IsNumber()
  success_rate?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonnelCvDto)
  cv_files?: PersonnelCvDto[];
}

export class PastProjectDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  client?: string;

  @IsOptional()
  @IsString()
  year?: string;

  @IsOptional()
  @IsNumber()
  budget_fcfa?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  domains?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  technologies?: string[];

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  personnel_names?: string[];

  /** Avancement du projet : « en_cours » ou « acheve » (défaut : acheve). */
  @IsOptional()
  @IsString()
  status?: string;
}

export class CompanyProfileDto {
  @IsOptional() @IsString() company_name?: string;
  @IsOptional() @IsString() legal_form?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() registration_ids?: string;

  @IsOptional() @IsNumber() annual_revenue?: number;
  @IsOptional() @IsNumber() available_cash?: number;
  @IsOptional() @IsNumber() credit_line?: number;

  @IsOptional() @IsString() description?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) domaines?: string[];

  /** Référentiel central : technologies et domaines sélectionnables dans toute l'application. */
  @IsOptional() @IsArray() @IsString({ each: true }) technologies_catalog?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) domains_catalog?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CertificationDto)
  certifications?: CertificationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompetencyDto)
  competencies?: CompetencyDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonnelDto)
  personnel?: PersonnelDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PastProjectDto)
  past_projects?: PastProjectDto[];

  @IsOptional() @IsString() intervention_zones?: string;
  @IsOptional() @IsString() consortium_experience?: string;
  @IsOptional() @IsString() partnership_capacity?: string;
  @IsOptional() @IsString() languages?: string;
  @IsOptional() @IsString() years_experience?: string;
  @IsOptional() @IsString() staff_headcount?: string;
  @IsOptional() @IsString() fiscal_social_compliance?: string;
  @IsOptional() @IsString() insurance_coverage?: string;
  @IsOptional() @IsString() financial_capacity_notes?: string;
  @IsOptional() @IsString() equipment_major_assets?: string;
  @IsOptional() @IsString() technical_qualifications?: string;
  @IsOptional() @IsString() strengths?: string;
}
