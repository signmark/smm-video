export type NotificationBroadcaster = (type: string, data: unknown) => void;

let broadcaster: NotificationBroadcaster = () => {};

export function setNotificationBroadcaster(nextBroadcaster: NotificationBroadcaster): void {
  broadcaster = nextBroadcaster;
}

export function broadcastNotification(type: string, data: unknown): void {
  broadcaster(type, data);
}
