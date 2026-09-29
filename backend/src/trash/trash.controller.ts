import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { MoveToTrashDto } from './dto/move-to-trash.dto';
import { TrashService } from './trash.service';
import { MinRole } from '../auth/roles.decorator';
import { Role } from '../auth/roles.enum';

@Controller('trash')
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  @Get()
  list() {
    return this.trash.list();
  }

  // Deplacer en corbeille = effet de bord d'une suppression autorisee (toutes
  // sessions authentifiees) ; la restauration et la purge sont reservees a l'admin systeme.
  @Post()
  move(@Body() dto: MoveToTrashDto) {
    return this.trash.move(dto);
  }

  @Post(':id/restore')
  @MinRole(Role.ADMIN_SYSTEME)
  restore(@Param('id') id: string) {
    return this.trash.restore(id);
  }

  @Delete(':id')
  @MinRole(Role.ADMIN_SYSTEME)
  deletePermanently(@Param('id') id: string) {
    return this.trash.deletePermanently(id);
  }
}
