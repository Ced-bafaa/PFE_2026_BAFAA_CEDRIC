import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ChatMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  content!: string;
}

export class ChatRequestDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];
}

export class ChatResponseDto {
  reply!: string;
  meta!: {
    aoCount: number;       // nombre d'AOs inclus dans le contexte
    contextChars: number;  // caractères envoyés pour les AOs
    estimatedTokens: number; // estimation tokens (chars / 4)
  };
}
