import { IsIn, IsOptional, IsString } from 'class-validator';
import type { TrashItemType } from '../trash.types';

const TYPES: TrashItemType[] = [
  'partner',
  'submitted_opportunity',
  'notification',
  'opportunity',
];

export class MoveToTrashDto {
  /** Id client (synchronisation write-through) — généré côté serveur si absent. */
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  deletedAt?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsIn(TYPES)
  type: TrashItemType;

  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  description?: string;

  // payload: unknown (accept anything)
  payload: unknown;
}
