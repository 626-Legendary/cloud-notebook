"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";

type Confirmation = { description: string; actionLabel: string };
type ConfirmContextValue = (description: string, actionLabel?: string) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function AlertDialogProvider({ children }: { children: ReactNode }) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const resolver = useRef<((accepted: boolean) => void) | null>(null);
  const finish = useCallback((accepted: boolean) => {
    resolver.current?.(accepted);
    resolver.current = null;
    setConfirmation(null);
  }, []);
  const confirm = useCallback<ConfirmContextValue>((description, actionLabel = "确认") => new Promise((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setConfirmation({ description, actionLabel });
  }), []);

  return <ConfirmContext.Provider value={confirm}>
    {children}
    <AlertDialog.Root open={confirmation !== null} onOpenChange={(open) => { if (!open) finish(false); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="alert-overlay" />
        <AlertDialog.Content className="alert-content">
          <AlertDialog.Title className="alert-title">请确认此操作</AlertDialog.Title>
          <AlertDialog.Description className="alert-description">{confirmation?.description}</AlertDialog.Description>
          <div className="alert-actions">
            <AlertDialog.Cancel className="button-outline" onClick={() => finish(false)}>取消</AlertDialog.Cancel>
            <AlertDialog.Action className="button-danger" onClick={() => finish(true)}>{confirmation?.actionLabel ?? "确认"}</AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </ConfirmContext.Provider>;
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside AlertDialogProvider.");
  return confirm;
}
