import { api } from "@/lib/api-client";
import { Section } from "@/components/encompass/Section";
import { Field } from "@/components/encompass/Field";
import { DecisionBar } from "@/components/encompass/DecisionBar";
import { ConditionsTable } from "@/components/encompass/ConditionsTable";
import { ConditionModal } from "@/components/encompass/ConditionModal";
import { TabBar } from "@/components/encompass/TabBar";
import { RunAgentButton } from "@/components/encompass/RunAgentButton";
import { RecommendationPanel } from "@/components/encompass/RecommendationPanel";
import { money, pct } from "@/lib/format";

export default async function TransmittalPage({
  params,
}: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;
  let loan;
  try {
    loan = await api.getLoan(loanId);
  } catch {
    await api.loadByLoan(loanId);
    loan = await api.getLoan(loanId);
  }
  const openCount = loan.conditions.filter((c) => c.status === "Open").length;
  const rcvdCount = loan.conditions.filter((c) => c.status === "Received").length;
  const clrCount = loan.conditions.filter((c) => c.status === "Cleared").length;

  return (
    <>
      <TabBar
        tabs={[
          { label: "Transmittal", href: `/loan/${loanId}/transmittal` },
          { label: "1003 Page 1", href: `/loan/${loanId}/1003/page1` },
          { label: "1003 Page 2", href: `/loan/${loanId}/1003/page2` },
          { label: "1003 Page 3", href: `/loan/${loanId}/1003/page3` },
        ]}
        activeLabel="Transmittal"
      />

      <Section title="Borrower & Property Information">
        <Field label="Borrower" value={loan.borrower.fullName} />
        <Field label="SSN" value={loan.borrower.ssnMasked} />
        <Field label="DOB" value={loan.borrower.dob} />
        <Field label="Marital" value={loan.borrower.maritalStatus} />
        <Field label="Subj. Address" value={loan.property.street} />
        <Field label="City" value={loan.property.city} />
        <Field label="State" value={loan.property.state} />
        <Field label="Zip" value={loan.property.zip} />
        <Field label="Occupancy" value={loan.transaction.occupancy} />
        <Field label="Property Type" value={loan.property.propertyType} />
        <Field label="Units" value={loan.property.units} />
        <Field label="Year Built" value={loan.property.yearBuilt} />
        <Field label="Sales Price" value={loan.transaction.salesPrice ? money(loan.transaction.salesPrice) : "—"} />
        <Field label="Apprs. Value" value={money(loan.transaction.appraisedValue)} />
        <Field label="Purpose" value={loan.transaction.loanPurpose} />
        <Field label="Lien" value={loan.transaction.lienPosition === 1 ? "1st" : "2nd"} />
      </Section>

      <Section title="Mortgage Information">
        <Field label="Loan Amount" value={money(loan.transaction.loanAmount)} />
        <Field label="Note Rate" value={pct(loan.transaction.noteRate, 4)} />
        <Field label="Term (mo)" value={loan.transaction.term} />
        <Field label="Amort" value={loan.transaction.amortType} />
        <Field label="LTV" value={pct(loan.transaction.ltv)} />
        <Field label="CLTV" value={pct(loan.transaction.cltv)} />
        <Field label="HCLTV" value={pct(loan.transaction.hcltv)} />
        <Field label="P&I" value={money(loan.qualifying.piPayment)} />
        <Field label="PITI" value={money(loan.transaction.piti)} />
        <Field label="Program" value={loan.nqmProgram} />
        <Field label="Qual Method" value={loan.qualifyingMethod} />
        <Field label="Qual Rate" value={pct(loan.qualifying.qualifyingRate, 4)} />
        <Field label="Channel" value="Retail" />
        <Field label="Investor" value="Non-QM" />
        <Field label="Occupancy" value={loan.transaction.occupancy} />
        <Field label="Lien" value={loan.transaction.lienPosition === 1 ? "1st" : "2nd"} />
      </Section>

      <Section title="Qualifying Ratios & Program Details">
        <Field label="Housing" value={pct(loan.qualifying.housingRatio)} />
        <Field label="Total DTI" value={pct(loan.qualifying.totalDti)} />
        <Field label="Monthly Inc." value={money(loan.income.totalMonthlyIncome)} />
        <Field label="Rep Score" value={loan.credit.repScore ?? "n/a"} />
        <Field label="Reserves (mo)" value={loan.assets.reservesMonths.toFixed(1)} />
        <Field label="Liquid Assets" value={money(loan.assets.totalLiquid)} />
        <Field label="Derived Inc." value={money(loan.qualifyingWorksheet.derivedMonthlyIncome)} />
        <Field label="Method" value={loan.qualifyingWorksheet.method} />
        <Field label="DSCR" value={loan.transaction.dscrRatio?.toFixed(2) ?? "—"} />
        <Field label="Rental Inc." value={loan.transaction.rentalIncome != null ? money(loan.transaction.rentalIncome) : "—"} />
        <Field label="AUS" value={loan.aus?.recommendation ?? "Manual UW"} />
        <Field label="AUS Engine" value={loan.aus?.engine ?? "—"} />
        <Field label="Milestone" value={loan.milestones.at(-1)?.name ?? "—"} />
        <Field label="Tradelines" value={`${loan.credit.tradelinesOpen}/${loan.credit.tradelinesTotal}`} />
        <Field label="Last Late" value={loan.credit.lastLate30d ?? "—"} />
        <Field label="Decision" value={loan.decision} />
      </Section>

      <DecisionBar loanId={loan.id} current={loan.decision} />

      <div className="mt-2 flex items-center gap-3 p-2 bg-[#f6f8fb] border border-[#6b7a8f]">
        <span className="text-[11px] font-bold text-[#1f4478]">AI Assist:</span>
        <RunAgentButton loanId={loan.id} hasRecommendation={!!loan.pendingRecommendation} />
      </div>

      {loan.pendingRecommendation && (
        <RecommendationPanel loanId={loan.id} rec={loan.pendingRecommendation} existingConditions={loan.conditions} />
      )}

      <div className="enc-sec mt-2">
        <h4>Conditions — {openCount} Open · {rcvdCount} Received · {clrCount} Cleared</h4>
        <div className="p-1">
          <ConditionsTable loanId={loan.id} conditions={loan.conditions} documents={loan.documents} />
          <div className="mt-2"><ConditionModal loanId={loan.id} /></div>
        </div>
      </div>
    </>
  );
}
