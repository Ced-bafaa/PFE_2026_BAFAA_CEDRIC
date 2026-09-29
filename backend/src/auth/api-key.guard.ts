import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Guard global par clé d'API partagée.
 *
 * Comportement :
 *  - KIAMA_API_KEY non définie → guard inactif (mode développement, aucun
 *    changement de comportement). Un avertissement est journalisé au premier
 *    appel pour rappeler que l'API est ouverte.
 *  - KIAMA_API_KEY définie → chaque requête doit porter l'en-tête
 *    `x-api-key` avec la valeur exacte, sinon 401.
 *
 * Les consommateurs légitimes (frontend via VITE_API_KEY, ao_extractor via
 * KIAMA_API_KEY) envoient l'en-tête automatiquement quand la clé est
 * configurée dans leur environnement.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private warnedOpenMode = false;

  canActivate(context: ExecutionContext): boolean {
    const expected = (process.env.KIAMA_API_KEY ?? '').trim();

    if (!expected) {
      if (!this.warnedOpenMode) {
        this.warnedOpenMode = true;
        this.logger.warn(
          'KIAMA_API_KEY non définie — API ouverte (mode développement). ' +
            'Définissez KIAMA_API_KEY pour activer la protection.',
        );
      }
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const provided = String(req.headers['x-api-key'] ?? '').trim();
    if (provided === expected) {
      return true;
    }
    throw new UnauthorizedException('Clé API manquante ou invalide (en-tête x-api-key).');
  }
}
