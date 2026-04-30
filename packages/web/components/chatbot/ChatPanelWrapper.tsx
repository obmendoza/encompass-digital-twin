import { getUser } from "@/lib/auth";
import ChatPanel from "./ChatPanel";

const DEMO_TENANT_ID = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad";

/**
 * Server component wrapper that resolves tenant context for the chatbot.
 * Renders nothing if user is not authenticated.
 * Falls back to demo tenant if user has no tenant_id in app_metadata.
 */
export default async function ChatPanelWrapper() {
  let tenantId: string | null = null;

  try {
    const user = await getUser();
    if (!user) return null;
    tenantId = user.tenantId || DEMO_TENANT_ID;
  } catch {
    return null;
  }

  return <ChatPanel tenantId={tenantId} />;
}
