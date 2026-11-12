import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AuthForm } from "@/components/auth-form";
import { getRegistrationEnabled } from "@/lib/system-settings";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.role === "ADMIN" ? "/admin" : "/app");
  const registrationEnabled = await getRegistrationEnabled();
  return <AuthForm mode="login" registrationEnabled={registrationEnabled} isTest={process.env.CLOUD_NOTEBOOK_ENV === "test"} />;
}
