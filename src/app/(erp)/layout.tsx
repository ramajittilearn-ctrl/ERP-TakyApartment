import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE, sessionActor } from "@/server/auth";
import { DemoProvider } from "@/demo/workspace";
import { AppShell } from "@/components/app-shell";
export const dynamic = "force-dynamic";
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await sessionActor((await cookies()).get(COOKIE)?.value);
  if (!actor) redirect("/login/");
  return (
    <DemoProvider>
      <AppShell actor={actor}>{children}</AppShell>
    </DemoProvider>
  );
}
