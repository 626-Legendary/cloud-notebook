import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
import { getRegistrationEnabled } from "@/lib/system-settings";

export default async function RegisterPage() {
  const session = await getSession();
  if (session) redirect(session.role === "ADMIN" ? "/admin" : "/app");
  const registrationEnabled = await getRegistrationEnabled();
  if (!registrationEnabled) redirect("/login");
  return <AuthForm mode="register" registrationEnabled={registrationEnabled} />;
}
