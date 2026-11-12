"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { notify } from "@/lib/notifications";
import { isUiFontSize, uiFontSizeCookie, type UiFontSize } from "@/lib/ui-typography";

type TypographyContext = {
  size: UiFontSize;
  pending: boolean;
  setSize: (value: UiFontSize) => Promise<void>;
};
const Context = createContext<TypographyContext | null>(null);

export function UiTypographyProvider({ initialSize, authenticated, children }: {
  initialSize: UiFontSize;
  authenticated: boolean;
  children: ReactNode;
}) {
  const [size, updateSize] = useState(initialSize);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.uiFontSize = size;
  }, [size]);

  const setSize = useCallback(async (value: UiFontSize) => {
    if (!isUiFontSize(value) || saving.current || value === size) return;
    saving.current = true;
    setPending(true);
    try {
      if (authenticated) {
        const response = await fetch("/api/settings/typography", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uiFontSize: value })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "无法保存界面字号");
      }
      // Server renders this cookie for anonymous/auth pages; signed-in users use DB.
      document.cookie = `${uiFontSizeCookie}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      document.documentElement.dataset.uiFontSize = value;
      updateSize(value);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "无法保存界面字号");
    } finally {
      saving.current = false;
      setPending(false);
    }
  }, [authenticated, size]);

  return <Context.Provider value={{ size, pending, setSize }}>{children}</Context.Provider>;
}

export function useUiTypography() {
  const value = useContext(Context);
  if (!value) throw new Error("useUiTypography requires UiTypographyProvider");
  return value;
}
