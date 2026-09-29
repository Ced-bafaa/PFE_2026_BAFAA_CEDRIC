import { Column, Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../auth/user.entity';

@Entity('audit_logs')
export class AuditLogEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  // Identité textuelle de l'acteur (e-mail, ou "service" / e-mail tenté) —
  // conservée telle quelle pour les cas sans compte (connexion échouée).
  @Column({ type: 'varchar', length: 255 })
  actor: string;

  // Liaison réutilisable vers l'utilisateur (association 1..* → 0..1).
  // Le rôle affiché dans les logs est dérivé de CET utilisateur (table users),
  // pas recopié. Nullable : connexions échouées / actions service = pas de compte.
  @Column({ name: 'actor_user_id', type: 'varchar', length: 36, nullable: true })
  actorUserId: string | null;

  @ManyToOne(() => User, { nullable: true, createForeignKeyConstraints: false })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser?: User | null;

  @Column({ type: 'varchar', length: 255 })
  action: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 128 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 255, nullable: true })
  entityId: string | null;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Column({ name: 'created_at', type: 'varchar', length: 64 })
  createdAt: string;
}
