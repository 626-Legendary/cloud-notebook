"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { notify } from "@/lib/notifications";
import { requestLogout } from "@/lib/logout-client";

export function useLogout(beforeLogout?: () => Promise<void>) {
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  async function logout() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await beforeLogout?.();
      await requestLogout();
      // Discard the authenticated App Router cache after cookie/session removal.
      window.location.replace("/login");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "退出登录失败，请重试");
      running.current = false;
      setPending(false);
    }
  }
  return { logout, pending };
}

export function LogoutProgress({ pending }: { pending: boolean }) {
  return <Dialog.Root open={pending}>
    <Dialog.Portal>
      <Dialog.Overlay className="logout-backdrop" />
      <Dialog.Content className="logout-progress" onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
        <Dialog.Title className="sr-only">退出登录</Dialog.Title>
        <div role="status" aria-live="polite">
          <LoaderCircle className="spin" size={22} />
          <Dialog.Description asChild><span>正在退出登录，请稍候…</span></Dialog.Description>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
