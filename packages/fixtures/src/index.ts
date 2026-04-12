import type { Scenario } from "@twin/core";
import { nqmBankstmt12moClean } from "./loans/nqm-bankstmt-12mo-clean.js";
import { nqmBankstmt24moBusiness } from "./loans/nqm-bankstmt-24mo-business.js";
import { nqmDscrInvestorPurchase } from "./loans/nqm-dscr-investor-purchase.js";
import { nqmDscrSub1 } from "./loans/nqm-dscr-sub-1.js";
import { nqmAssetDepletion } from "./loans/nqm-asset-depletion.js";
import { nqm1099Only } from "./loans/nqm-1099-only.js";
import { nqmPnlOnlyCpa } from "./loans/nqm-pnl-only-cpa.js";
import { nqmForeignNational } from "./loans/nqm-foreign-national.js";
import { nqmItinBankstmt } from "./loans/nqm-itin-bankstmt.js";
import { nqmFullDocRecentBk } from "./loans/nqm-full-doc-recent-bk.js";
import { nqmSuspendCandidate } from "./loans/nqm-suspend-candidate.js";
import { nqmDenyCandidate } from "./loans/nqm-deny-candidate.js";
import { nqmEdgeLargeDeposit } from "./loans/nqm-edge-large-deposit.js";
import { nqmEdgeDecliningIncome } from "./loans/nqm-edge-declining-income.js";
import { nqmEdgeComingledFunds } from "./loans/nqm-edge-comingled-funds.js";
import { nqmEdgeShortLeaseDscr } from "./loans/nqm-edge-short-lease-dscr.js";
import { nqmEdgeRestrictedAssets } from "./loans/nqm-edge-restricted-assets.js";
import { nqmEdgeNsfCompensating } from "./loans/nqm-edge-nsf-compensating.js";
import { nqmEdgePropertyFlip } from "./loans/nqm-edge-property-flip.js";
import { nqmEdgeGiftFundsNqm } from "./loans/nqm-edge-gift-funds-nqm.js";

const all: Scenario[] = [
  nqmBankstmt12moClean, nqmBankstmt24moBusiness, nqmDscrInvestorPurchase, nqmDscrSub1,
  nqmAssetDepletion, nqm1099Only, nqmPnlOnlyCpa, nqmForeignNational, nqmItinBankstmt,
  nqmFullDocRecentBk, nqmSuspendCandidate, nqmDenyCandidate,
  nqmEdgeLargeDeposit, nqmEdgeDecliningIncome, nqmEdgeComingledFunds, nqmEdgeShortLeaseDscr,
  nqmEdgeRestrictedAssets, nqmEdgeNsfCompensating, nqmEdgePropertyFlip, nqmEdgeGiftFundsNqm,
];
export const scenarios: Record<string, Scenario> = Object.fromEntries(all.map((s) => [s.id, s]));
export function listScenarios() {
  return all.map(({ id, name, description }) => ({ id, name, description }));
}
