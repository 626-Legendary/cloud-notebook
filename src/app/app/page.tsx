import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Workspace } from "@/components/workspace";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "ADMIN") redirect("/admin");
  if (session.mustChangePassword) redirect("/change-password");
  return <Workspace appVersion={process.env.APP_VERSION?.trim() || "1.1.1119"} />;
}
