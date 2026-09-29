import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from './user.entity';
import { Role } from './roles.enum';
import { AuditService } from '../audit/audit.service';

export type AuthUserPublic = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  email: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
};

/** Domaine e-mail imposé pour les comptes créés. */
const EMAIL_DOMAIN = '@kiama.cm';

/** Verrouillage anti-force brute : nombre d'échecs consécutifs tolérés et durée. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /** Écrit un log d'audit sans jamais faire échouer l'action métier. */
  private log(
    action: string,
    entityType: string,
    actor: string,
    extra?: { entityId?: string; details?: string; actorUserId?: string },
  ): void {
    void this.audit
      .add(
        { action, entityType, entityId: extra?.entityId, details: extra?.details },
        actor,
        extra?.actorUserId,
      )
      .catch(() => undefined);
  }

  async onModuleInit(): Promise<void> {
    await this.seedUsers();
  }

  /** Crée, au premier démarrage, un compte par rôle s'ils n'existent pas. */
  private async seedUsers(): Promise<void> {
    const seeds = [
      {
        email: (process.env.KIAMA_ADMIN_EMAIL || 'admin@kiama.local').toLowerCase(),
        name: 'Admin Système',
        role: Role.ADMIN_SYSTEME,
        password: process.env.KIAMA_ADMIN_PASSWORD || 'Admin#2026',
      },
      {
        email: 'exploitation@kiama.local',
        name: 'Admin Exploitation',
        role: Role.ADMIN_EXPLOITATION,
        password: process.env.KIAMA_EXPLOITATION_PASSWORD || 'Exploit#2026',
      },
      {
        email: 'user@kiama.local',
        name: 'Utilisateur Test',
        role: Role.USER,
        password: process.env.KIAMA_USER_PASSWORD || 'User#2026',
      },
    ];

    for (const s of seeds) {
      const existing = await this.users.findOne({ where: { email: s.email } });
      if (existing) continue;
      const passwordHash = await bcrypt.hash(s.password, 10);
      await this.users.save(
        this.users.create({ email: s.email, name: s.name, role: s.role, passwordHash, active: true }),
      );
      this.logger.warn(`[auth] Compte initial créé : ${s.email} (${s.role})`);
    }
  }

  async login(email: string, password: string): Promise<{ access_token: string; user: AuthUserPublic }> {
    const normalized = (email || '').trim().toLowerCase();
    const user = await this.users.findOne({ where: { email: normalized } });
    if (!user || !user.active) {
      this.log('login_failed', 'auth', normalized || 'inconnu', {
        details: !user ? 'Compte inexistant' : 'Compte désactivé',
      });
      throw new UnauthorizedException('Identifiants invalides.');
    }

    // Verrouillage anti-force brute : refuser tant que la fenêtre n'est pas écoulée.
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      this.log('login_locked', 'auth', normalized, { details: `Verrouillé ${mins} min`, actorUserId: user.id });
      throw new UnauthorizedException(
        `Compte temporairement verrouillé après plusieurs tentatives. Réessayez dans ${mins} minute(s).`,
      );
    }

    const ok = await bcrypt.compare(password || '', user.passwordHash);
    if (!ok) {
      user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
      let locked = false;
      if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
        user.failedLoginAttempts = 0;
        locked = true;
      }
      await this.users.save(user);
      this.log('login_failed', 'auth', normalized, {
        details: locked ? `Compte verrouillé ${LOCK_MINUTES} min (${MAX_FAILED_ATTEMPTS} échecs)` : 'Mot de passe incorrect',
        actorUserId: user.id,
      });
      throw new UnauthorizedException(
        locked
          ? `Trop de tentatives. Compte verrouillé pendant ${LOCK_MINUTES} minutes.`
          : 'Identifiants invalides.',
      );
    }

    // Connexion réussie : on remet à zéro le compteur et le verrou éventuel.
    if (user.failedLoginAttempts !== 0 || user.lockedUntil) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      await this.users.save(user);
    }

    const payload = { sub: user.id, email: user.email, role: user.role, name: user.name };
    const access_token = await this.jwt.signAsync(payload);
    this.log('login', 'auth', user.email, { details: `Rôle : ${user.role}`, actorUserId: user.id });
    return { access_token, user: this.toPublic(user) };
  }

  /**
   * Changement de mot de passe par l'utilisateur connecté (aussi utilisé pour le
   * changement obligatoire à la première connexion). Vérifie le mot de passe
   * actuel, impose une complexité minimale, puis lève l'obligation de changement.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ ok: true }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const current = await bcrypt.compare(currentPassword || '', user.passwordHash);
    if (!current) throw new UnauthorizedException('Mot de passe actuel incorrect.');

    const pw = String(newPassword ?? '');
    if (pw.length < 10 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) {
      throw new BadRequestException(
        'Le nouveau mot de passe doit contenir au moins 10 caractères, dont une minuscule, une majuscule et un chiffre.',
      );
    }
    if (await bcrypt.compare(pw, user.passwordHash)) {
      throw new BadRequestException("Le nouveau mot de passe doit être différent de l'ancien.");
    }

    user.passwordHash = await bcrypt.hash(pw, 10);
    user.mustChangePassword = false;
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await this.users.save(user);
    this.log('password_changed', 'auth', user.email, { actorUserId: user.id });
    return { ok: true };
  }

  toPublic(u: User): AuthUserPublic {
    return {
      id: u.id,
      name: u.name,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      position: u.position ?? null,
      email: u.email,
      role: u.role,
      active: u.active,
      mustChangePassword: u.mustChangePassword ?? false,
    };
  }

  // ── Gestion des comptes (réservée à l'admin système via le contrôleur) ──────

  /** Génère un mot de passe fort (majuscule, minuscule, chiffre, symbole). */
  private generatePassword(length = 14): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I/O ambigus
    const lower = 'abcdefghijkmnpqrstuvwxyz'; // sans l
    const digits = '23456789'; // sans 0/1
    const special = '!@#$%&*?';
    const all = upper + lower + digits + special;
    const pick = (set: string) => set[crypto.randomInt(set.length)];
    const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
    while (chars.length < length) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = crypto.randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  private normalizeRole(role?: string): Role {
    if (role === Role.USER || role === Role.ADMIN_EXPLOITATION || role === Role.ADMIN_SYSTEME) {
      return role;
    }
    throw new BadRequestException('Rôle invalide.');
  }

  /** Empêche de retirer le dernier admin système actif (verrouillage total). */
  private async ensureNotLastActiveAdmin(userId: string): Promise<void> {
    const admins = await this.users.find({ where: { role: Role.ADMIN_SYSTEME, active: true } });
    const remaining = admins.filter((a) => a.id !== userId);
    if (remaining.length === 0) {
      throw new BadRequestException('Impossible : ce compte est le dernier administrateur système actif.');
    }
  }

  async listUsers(): Promise<AuthUserPublic[]> {
    const all = await this.users.find({ order: { createdAt: 'ASC' } });
    return all.map((u) => this.toPublic(u));
  }

  /** Impose le domaine @kiama.cm — BLOQUE toute autre extension au lieu de l'ignorer. */
  private buildEmail(input?: string): string {
    const raw = String(input ?? '').trim().toLowerCase();
    let local = raw;
    if (raw.includes('@')) {
      const [localPart, domain] = raw.split('@');
      if (domain !== 'kiama.cm') {
        throw new BadRequestException(
          "Seule l'extension @kiama.cm est autorisée pour les comptes KIAMA.",
        );
      }
      local = localPart;
    }
    if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(local)) {
      throw new BadRequestException(
        "Identifiant e-mail invalide (lettres, chiffres, . _ - avant @kiama.cm).",
      );
    }
    return `${local}${EMAIL_DOMAIN}`;
  }

  async createUser(input: {
    firstName?: string;
    lastName?: string;
    position?: string;
    email?: string;
    role?: string;
  }): Promise<{ user: AuthUserPublic; password: string }> {
    const firstName = (input.firstName ?? '').trim();
    const lastName = (input.lastName ?? '').trim();
    const position = (input.position ?? '').trim();
    const role = this.normalizeRole(input.role);
    if (!firstName || !lastName) throw new BadRequestException('Prénom et nom requis.');
    const email = this.buildEmail(input.email);
    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw new BadRequestException('Un compte existe déjà avec cet e-mail.');

    const name = `${firstName} ${lastName}`.trim();
    const password = this.generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);
    const saved = await this.users.save(
      this.users.create({
        name,
        firstName,
        lastName,
        position: position || null,
        email,
        role,
        passwordHash,
        active: true,
        mustChangePassword: true,
      }),
    );
    this.logger.warn(`[users] Compte créé : ${email} (${role})`);
    return { user: this.toPublic(saved), password };
  }

  async updateUser(
    id: string,
    input: { firstName?: string; lastName?: string; position?: string; role?: string; active?: boolean },
    currentUserId?: string,
  ): Promise<AuthUserPublic> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    const wasAdminSysteme = user.role === Role.ADMIN_SYSTEME;
    const deactivating = input.active === false;
    const demoting = typeof input.role === 'string' && this.normalizeRole(input.role) !== Role.ADMIN_SYSTEME;

    // Anti-verrouillage : on ne se désactive ni ne se rétrograde soi-même.
    if (currentUserId && user.id === currentUserId) {
      if (deactivating) throw new BadRequestException('Vous ne pouvez pas désactiver votre propre compte.');
      if (demoting) throw new BadRequestException('Vous ne pouvez pas modifier votre propre rôle.');
    }
    // Ne jamais retirer le dernier admin système actif.
    if (wasAdminSysteme && (deactivating || demoting)) {
      await this.ensureNotLastActiveAdmin(user.id);
    }

    if (typeof input.firstName === 'string') user.firstName = input.firstName.trim() || null;
    if (typeof input.lastName === 'string') user.lastName = input.lastName.trim() || null;
    if (typeof input.position === 'string') user.position = input.position.trim() || null;
    if (typeof input.firstName === 'string' || typeof input.lastName === 'string') {
      user.name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.name;
    }
    if (typeof input.role === 'string') user.role = this.normalizeRole(input.role);
    if (typeof input.active === 'boolean') user.active = input.active;

    const saved = await this.users.save(user);
    this.logger.warn(`[users] Compte mis à jour : ${saved.email} (${saved.role}, actif=${saved.active})`);
    return this.toPublic(saved);
  }

  async resetPassword(id: string): Promise<{ password: string }> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
    const password = this.generatePassword();
    user.passwordHash = await bcrypt.hash(password, 10);
    user.mustChangePassword = true;
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await this.users.save(user);
    this.logger.warn(`[users] Mot de passe réinitialisé : ${user.email}`);
    return { password };
  }
}
