import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { SubmissionPhase } from '../tracking.types';

const PHASES: SubmissionPhase[] = [
  'depose',
  'en_evaluation',
  'clarification',
  'negociation',
  'attribue',
  'rejete',
];

export class TrackingLineDto {
  @IsIn(PHASES)
  phase: SubmissionPhase;

  @IsArray()
  @IsString({ each: true })
  notes: string[];
}

export class UpdateTrackingDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrackingLineDto)
  lines?: TrackingLineDto[];
}
