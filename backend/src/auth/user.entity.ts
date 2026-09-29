import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from './roles.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nom d'affichage composé (« Prénom Nom ») — conservé pour compat (JWT, UI).
  @Column({ length: 160 })
  name: string;

  @Column({ name: 'first_name', type: 'varchar', length: 80, nullable: true })
  firstName: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 80, nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  position: string | null;

  // 190 : sous la limite d'index unique utf8mb4 de MySQL (191).
  @Column({ unique: true, length: 190 })
  email: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 32, default: Role.USER })
  role: Role;

  @Column({ default: true })
  active: boolean;

  /** Force le changement de mot de passe à la prochaine connexion (comptes créés/réinitialisés). */
  @Column({ name: 'must_change_password', default: false })
  mustChangePassword: boolean;

  /** Compteur d'échecs de connexion consécutifs (anti-force brute). */
  @Column({ name: 'failed_login_attempts', type: 'int', default: 0 })
  failedLoginAttempts: number;

  /** Date jusqu'à laquelle le compte est verrouillé (null = non verrouillé). */
  @Column({ name: 'locked_until', type: 'datetime', nullable: true })
  lockedUntil: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
