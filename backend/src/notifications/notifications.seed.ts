import type { AppNotification } from './notifications.types';

export const notificationsSeed: AppNotification[] = [
  {
    id: 1,
    type: 'urgent',
    title: 'Echeance proche : CHU Douala',
    message: "L'appel d'offres AO-2026-001 expire dans 3 jours. Score: 92/100.",
    time: 'Il y a 2h',
    read: false,
    opportunityId: 'AO-2026-001',
  },
  {
    id: 2,
    type: 'success',
    title: 'Nouvelle opportunite qualifiee',
    message:
      'Solution de cybersécurité BEAC — Score 85/100, soumission recommandee.',
    time: 'Il y a 5h',
    read: false,
    opportunityId: 'AO-2026-004',
  },
];
