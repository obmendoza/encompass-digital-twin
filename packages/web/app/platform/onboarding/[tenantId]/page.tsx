import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ tenantId: string }>;
}

export default async function OnboardingPage({ params }: PageProps) {
  const user = await getUser();
  if (!user || (!user.isSuperAdmin && !["admin"].includes(user.role))) redirect("/");

  const { tenantId } = await params;
  const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
  const headers: Record<string, string> = {
    "x-super-admin": "true",
    "x-user-id": user?.email ?? "admin",
  };

  // Fetch onboarding session
  let session = null;
  try {
    const res = await fetch(`${apiUrl}/onboarding/${tenantId}`, { headers, cache: "no-store" });
    if (res.ok) session = await res.json();
  } catch (e) {
    console.error("Failed to fetch onboarding session:", e);
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8 max-w-md text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Session Not Found</h2>
          <p className="text-sm text-gray-500">
            No active onboarding session found for this tenant. It may have been completed or abandoned.
          </p>
          <a
            href="/platform/tenants"
            className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
          >
            Back to Tenants
          </a>
        </div>
      </div>
    );
  }

  // Fetch tenant details for pre-populating forms
  let tenant = { id: tenantId, name: "", slug: "", settings: {} };
  try {
    const res = await fetch(`${apiUrl}/tenants`, { headers, cache: "no-store" });
    if (res.ok) {
      const tenants = await res.json();
      const found = tenants.find((t: { id: string }) => t.id === tenantId);
      if (found) tenant = found;
    }
  } catch (e) {
    console.error("Failed to fetch tenant:", e);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <a
              href="/platform/tenants"
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Tenants
            </a>
            <span className="text-gray-300">/</span>
            <span className="text-sm text-gray-600 font-medium">Onboarding</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {tenant.name || "New Lender"} Onboarding
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Complete each step to activate this lender on the platform.
          </p>
        </div>

        <OnboardingWizard session={session} tenant={tenant} />
      </div>
    </div>
  );
}
