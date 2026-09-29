import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { UpdateTrackingDto } from './dto/update-tracking.dto';
import { TrackingService } from './tracking.service';

@Controller('submission-tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  /** Liste complète — utilisée par l'hydratation du cache front au démarrage. */
  @Get()
  list() {
    return this.tracking.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tracking.get(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTrackingDto) {
    return this.tracking.update(id, { lines: dto.lines });
  }
}
