import { ClinicalShell } from "@/components/clinical/ClinicalShell";
import { getCommandCenterSnapshot } from "@/lib/services/command-center.service";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

export default async function HomePage() {
  const initialSnapshot = await getCommandCenterSnapshot();
  return <ClinicalShell initialSnapshot={initialSnapshot} />;
}
