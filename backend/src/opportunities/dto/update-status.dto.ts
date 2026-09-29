import { IsIn } from 'class-validator';

const ALLOWED = [
  'nouveau',
  'en_analyse',
  'qualifie',
  'soumis',
  'gagne',
  'perdu',
] as const;

export class UpdateOpportunityStatusDto {
  @IsIn(ALLOWED)
  status: (typeof ALLOWED)[number];
}
