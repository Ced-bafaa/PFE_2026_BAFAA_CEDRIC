import { SetMetadata } from '@nestjs/common';

/** Marque une route comme publique (ni JWT ni rôle requis). Ex. /auth/login, /health. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
