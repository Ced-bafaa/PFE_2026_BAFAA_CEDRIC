import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { DeleteNotificationsDto } from './dto/delete-notifications.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list() {
    return this.notifications.list();
  }

  @Post(':id/read')
  markRead(@Param('id') id: string) {
    return this.notifications.markRead(Number(id));
  }

  @Post('read-all')
  markAllRead() {
    return this.notifications.markAllRead();
  }

  @Delete()
  deleteMany(@Body() dto: DeleteNotificationsDto) {
    return this.notifications.deleteMany(dto.ids);
  }
}
