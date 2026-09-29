import { IsArray, IsNumber } from 'class-validator';

export class DeleteNotificationsDto {
  @IsArray()
  @IsNumber({}, { each: true })
  ids: number[];
}
