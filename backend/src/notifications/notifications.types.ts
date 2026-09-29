export type NotificationType = 'urgent' | 'success' | 'info' | 'warning';

export type AppNotification = {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  time: string;
  read: boolean;
  opportunityId?: string;
};
