import { getUser } from "@/lib/auth";
import ChatPanel from "./ChatPanel";

/**
 * Server component wrapper that resolves tenant context for the chatbot.
 * Renders nothing if user is not authenticated or has no tenant.
 * Added to root layout so the chatbot appears on every page.
 */
export default async function ChatPanelWrapper() {
  let tenantId: string | null = null;

  try {
    const user = await getUser();
    if (user?.tenantId) {
      tenantId = user.tenantId;
    }
  } catch {
    // Not authenticated or auth error — don't render chatbot
    return null;
  }

  if (!tenantId) return null;

  return <ChatPanel tenantId={tenantId} />;
}
