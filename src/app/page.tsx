import { getServerSession } from "@/lib/auth/session";
import { getCommandCenterSnapshot } from "@/lib/services/command-center.service";
import { ClinicalShell } from "@/components/clinical/ClinicalShell";
import { LoginView } from "@/components/clinical/LoginView";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

export default async function HomePage() {
  const session = await getServerSession();
  if (!session) {
    return <LoginView />;
  }

  const initialSnapshot = await getCommandCenterSnapshot(undefined, session.role);
  return (
    <ClinicalShell
      initialSnapshot={initialSnapshot}
      sessionUser={{
        username: session.username,
        displayName: session.displayName,
        role: session.role,
      }}
    />
  );
}
