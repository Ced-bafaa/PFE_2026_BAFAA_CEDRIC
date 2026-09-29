export type TrashItemType =
  | 'partner'
  | 'submitted_opportunity'
  | 'notification'
  | 'opportunity';

export type TrashItem = {
  id: string;
  type: TrashItemType;
  label: string;
  description?: string;
  payload: unknown;
  deletedAt: string;
  expiresAt: string;
};
