import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('trash_items')
export class TrashItemEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  @Column({ type: 'varchar', length: 32 })
  type: string;

  @Column({ type: 'varchar', length: 512 })
  label: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'json' })
  payload: unknown;

  @Column({ name: 'deleted_at', type: 'varchar', length: 64 })
  deletedAt: string;

  @Column({ name: 'expires_at', type: 'varchar', length: 64 })
  expiresAt: string;
}
