import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type { Partner } from '../seed/mock-data';
import { UpsertPartnerDto } from './dto/upsert-partner.dto';
import { PartnersService } from './partners.service';

@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  list(): Promise<Partner[]> {
    return this.partners.list();
  }

  @Post()
  create(@Body() dto: UpsertPartnerDto): Promise<Partner> {
    return this.partners.create(dto);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpsertPartnerDto,
  ): Promise<Partner> {
    return this.partners.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.partners.remove(id);
  }
}
