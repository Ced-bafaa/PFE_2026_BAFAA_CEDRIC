import { SetMetadata } from '@nestjs/common';
import { Role } from './roles.enum';

/**
 * Rôle MINIMUM requis pour la route (hiérarchique).
 * Ex. @MinRole(Role.ADMIN_SYSTEME) → admin système uniquement.
 *     @MinRole(Role.ADMIN_EXPLOITATION) → exploitation OU système.
 * Peut être posé au niveau classe (contrôleur) et surchargé par méthode.
 */
export const ROLES_KEY = 'minRole';
export const MinRole = (role: Role) => SetMetadata(ROLES_KEY, role);
