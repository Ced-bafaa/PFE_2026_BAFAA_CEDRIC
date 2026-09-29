/** Rôles hiérarchiques de KIAMA (niveau croissant de privilèges). */
export enum Role {
  USER = 'user',
  ADMIN_EXPLOITATION = 'admin_exploitation',
  ADMIN_SYSTEME = 'admin_systeme',
}

/** Niveau de privilège : sert aux comparaisons « rôle minimum requis ». */
export const ROLE_LEVEL: Record<Role, number> = {
  [Role.USER]: 1,
  [Role.ADMIN_EXPLOITATION]: 2,
  [Role.ADMIN_SYSTEME]: 3,
};

export const ALL_ROLES: Role[] = [Role.USER, Role.ADMIN_EXPLOITATION, Role.ADMIN_SYSTEME];
