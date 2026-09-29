import { IsString, MinLength } from 'class-validator';

export class ScoreByPdfDto {
  @IsString()
  @MinLength(1)
  nomFichier!: string;
}
