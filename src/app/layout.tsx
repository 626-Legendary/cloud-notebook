import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { normalizeUiFontSize, uiFontSizeCookie } from "@/lib/ui-typography";
import { UiTypographyProvider } from "@/components/ui-typography-provider";
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { AlertDialogProvider } from "@/components/ui/alert-dialog";
import { FormDialogProvider } from "@/components/ui/dialog";
import { ToastProvider } from "@/components/ui/toast-provider";
import "./globals.css";
import { editorFontVariables } from "./fonts";

export const metadata: Metadata = {
  title: "Cloud Notebook",
  description: "属于自己的私密笔记空间",
  icons: {
    icon: { url: "/icon.png", type: "image/png", sizes: "512x512" },
    shortcut: "/icon.png"
  }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  const [settings] = session ? await db.select({ uiFontSize: userSettings.uiFontSize }).from(userSettings)
    .where(eq(userSettings.userId, session.userId)).limit(1) : [];
  const initialSize = normalizeUiFontSize(session ? settings?.uiFontSize : (await cookies()).get(uiFontSizeCookie)?.value);
  return (
    <html lang="zh-CN" data-ui-font-size={initialSize} suppressHydrationWarning>
      <body className={editorFontVariables}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <UiTypographyProvider key={session?.userId ?? "guest"} initialSize={initialSize} authenticated={Boolean(session && !session.mustChangePassword)}>
          <AlertDialogProvider><FormDialogProvider><ToastProvider>{children}</ToastProvider></FormDialogProvider></AlertDialogProvider>
          </UiTypographyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
