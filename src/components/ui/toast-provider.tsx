"use client";

import { Check, Info, OctagonAlert, TriangleAlert, X } from "lucide-react";
import { ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NotificationDetail } from "@/lib/notifications";
import { notificationClock, releaseNotification } from "@/lib/notifications";

const icons = {
  success: Check,
  error: OctagonAlert,
  warning: TriangleAlert,
  info: Info
};

type ToastItem = NotificationDetail & {
  remaining: number;
  deadline: number;
};

const ToastAnchorContext = createContext<((node: HTMLDivElement | null) => void) | null>(null);

export function ToastViewportAnchor() {
  const setAnchor = useContext(ToastAnchorContext);
  return <div className="editor-toast-anchor" ref={setAnchor} />;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const activeTimers = timers.current;
    function dismiss(id: string) {
      const timer = activeTimers.get(id);
      if (timer) clearTimeout(timer);
      activeTimers.delete(id);
      releaseNotification(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }

    function onNotification(event: Event) {
      const detail = (event as CustomEvent<NotificationDetail>).detail;
      const toast: ToastItem = {
        ...detail,
        remaining: detail.duration,
        deadline: notificationClock() + detail.duration
      };
      setToasts((current) => [...current, toast].slice(-4));
      activeTimers.set(detail.id, setTimeout(() => dismiss(detail.id), detail.duration));
    }

    window.addEventListener("cloud-notebook:notification", onNotification);
    return () => {
      window.removeEventListener("cloud-notebook:notification", onNotification);
      for (const timer of activeTimers.values()) clearTimeout(timer);
      activeTimers.clear();
    };
  }, []);

  function pause(id: string) {
    const toast = toasts.find((item) => item.id === id);
    if (!toast) return;
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    const remaining = Math.max(0, toast.deadline - notificationClock());
    setToasts((current) => current.map((item) => item.id === id ? { ...item, remaining } : item));
  }

  function resume(id: string) {
    const toast = toasts.find((item) => item.id === id);
    if (!toast || timers.current.has(id)) return;
    const deadline = notificationClock() + toast.remaining;
    timers.current.set(id, setTimeout(() => {
      timers.current.delete(id);
      releaseNotification(id);
      setToasts((current) => current.filter((item) => item.id !== id));
    }, toast.remaining));
    setToasts((current) => current.map((item) => item.id === id ? { ...item, deadline } : item));
  }

  function dismiss(id: string) {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    releaseNotification(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  const viewport = <div className="toast-viewport" aria-label="通知" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => {
        const Icon = icons[toast.type];
        return <div
          className={`app-toast toast-${toast.type}`}
          key={toast.id}
          role="status"
          onPointerEnter={() => pause(toast.id)}
          onPointerLeave={() => resume(toast.id)}
        >
          <Icon size={17} aria-hidden="true" />
          <span>{toast.message}</span>
          <button type="button" aria-label="关闭通知" onClick={() => dismiss(toast.id)}><X size={15} /></button>
        </div>;
      })}
    </div>;

  return <ToastAnchorContext.Provider value={setAnchor}>
    {children}
    {anchor ? createPortal(viewport, anchor) : viewport}
  </ToastAnchorContext.Provider>;
}
