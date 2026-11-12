export type NotificationType = "success" | "error" | "warning" | "info";

export const notificationDurations: Record<NotificationType, number> = {
  success: 3000,
  info: 4000,
  warning: 5000,
  error: 5000
};

export function notificationClock() {
  return Date.now();
}

type NotificationDetail = {
  type: NotificationType;
  message: string;
  id: string;
  duration: number;
};

const activeMessages = new Map<string, ReturnType<typeof setTimeout>>();

function publish(type: NotificationType, message: string, id = `${type}:${message}`) {
  if (!message || typeof window === "undefined" || activeMessages.has(id)) return;
  const detail: NotificationDetail = { type, message, id, duration: notificationDurations[type] };
  activeMessages.set(id, setTimeout(() => activeMessages.delete(id), detail.duration));
  window.dispatchEvent(new CustomEvent<NotificationDetail>("cloud-notebook:notification", { detail }));
}

export function releaseNotification(id: string) {
  const timer = activeMessages.get(id);
  if (timer) clearTimeout(timer);
  activeMessages.delete(id);
}

export const notify = {
  success: (message: string, id?: string) => publish("success", message, id),
  error: (message: string, id?: string) => publish("error", message, id),
  warning: (message: string, id?: string) => publish("warning", message, id),
  info: (message: string, id?: string) => publish("info", message, id)
};

export type { NotificationDetail };
