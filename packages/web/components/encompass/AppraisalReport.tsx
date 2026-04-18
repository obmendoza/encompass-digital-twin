"use client";

import { useState } from "react";
import type { Loan, ComparableSale } from "@twin/core";
import { money } from "@/lib/format";

interface Props {
  loan: Loan;
}

type SortKey = "address" | "salePrice" | "saleDate" | "sqft" | "distance" | "adjustedValue" | "adjDiff";
type SortDir = "asc" | "desc";

function SortHeader({
  label, sortKey, current, dir, onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <th
      className="px-2 py-[2px] text-left cursor-pointer select-none whitespace-nowrap hover:bg-[#d4cdb5]"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active ? (dir === "asc" ? " ▲" : " ▼") : " ↕"}
    </th>
  );
}

export function AppraisalReport({ loan }: Props) {
  const { property, transaction, appraisal } = loan;
  const [sortKey, setSortKey] = useState<SortKey>("distance");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  function adjDiff(c: ComparableSale): number {
    return c.adjustedValue - appraisal.appraisedValue;
  }

  const sorted = [...appraisal.comparables].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "address") cmp = a.address.localeCompare(b.address);
    else if (sortKey === "salePrice") cmp = a.salePrice - b.salePrice;
    else if (sortKey === "saleDate") cmp = a.saleDate.localeCompare(b.saleDate);
    else if (sortKey === "sqft") cmp = a.sqft - b.sqft;
    else if (sortKey === "distance") cmp = parseFloat(a.distance) - parseFloat(b.distance);
    else if (sortKey === "adjustedValue") cmp = a.adjustedValue - b.adjustedValue;
    else if (sortKey === "adjDiff") cmp = adjDiff(a) - adjDiff(b);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const salesPrice = transaction.salesPrice;
  const difference = salesPrice != null ? appraisal.appraisedValue - salesPrice : null;
  let valueFlag = "—";
  if (salesPrice != null) {
    if (appraisal.appraisedValue === salesPrice) valueFlag = "At Value";
    else if (appraisal.appraisedValue > salesPrice) valueFlag = "Above Sales";
    else valueFlag = "Below Sales";
  }

  const valueFlagColor =
    valueFlag === "At Value" ? "text-[#006400]" :
    valueFlag === "Above Sales" ? "text-[#0a52a0]" :
    valueFlag === "Below Sales" ? "text-[#c00] font-bold" : "";

  return (
    <div>
      {/* Subject Property */}
      <div className="enc-sec mb-2">
        <h4>Subject Property</h4>
        <div className="enc-grid-8">
          <div className="enc-field"><label>Street</label><div className="v">{property.street}</div></div>
          <div className="enc-field"><label>City</label><div className="v">{property.city}</div></div>
          <div className="enc-field"><label>State</label><div className="v">{property.state}</div></div>
          <div className="enc-field"><label>Zip</label><div className="v">{property.zip}</div></div>
          <div className="enc-field"><label>Type</label><div className="v">{property.propertyType}</div></div>
          <div className="enc-field"><label>Units</label><div className="v">{property.units}</div></div>
          <div className="enc-field"><label>Year Built</label><div className="v">{property.yearBuilt}</div></div>
          <div className="enc-field"><label>Occupancy</label><div className="v">{transaction.occupancy}</div></div>
        </div>
      </div>

      {/* Appraisal Details */}
      <div className="enc-sec mb-2">
        <h4>Appraisal Details</h4>
        <div className="enc-grid-8">
          <div className="enc-field"><label>Appraised Value</label><div className="v font-bold">{money(appraisal.appraisedValue)}</div></div>
          <div className="enc-field"><label>Appraisal Date</label><div className="v">{appraisal.appraisalDate}</div></div>
          <div className="enc-field"><label>Appraiser</label><div className="v">{appraisal.appraiserName}</div></div>
          <div className="enc-field"><label>Type</label><div className="v">{appraisal.appraisalType}</div></div>
          <div className="enc-field"><label>Market Condition</label><div className="v">{appraisal.marketCondition}</div></div>
          <div className="enc-field"><label>Neighborhood</label><div className="v">{appraisal.neighborhoodRating}</div></div>
          <div className="enc-field"><label>Site Area</label><div className="v">{appraisal.siteArea}</div></div>
          <div className="enc-field"><label>GLA (sq ft)</label><div className="v">{appraisal.grossLivingArea.toLocaleString()}</div></div>
          <div className="enc-field"><label>Rooms</label><div className="v">{appraisal.roomCount}</div></div>
          <div className="enc-field"><label>Bedrooms</label><div className="v">{appraisal.bedroomCount}</div></div>
          <div className="enc-field"><label>Bathrooms</label><div className="v">{appraisal.bathroomCount}</div></div>
          <div className="enc-field"><label>Garage Spaces</label><div className="v">{appraisal.garageSpaces}</div></div>
          <div className="enc-field"><label>Condition</label><div className="v">{appraisal.condition}</div></div>
          {appraisal.notes && (
            <div className="enc-field" style={{ gridColumn: "span 3" }}><label>Notes</label><div className="v">{appraisal.notes}</div></div>
          )}
        </div>
      </div>

      {/* Value Reconciliation */}
      <div className="enc-sec mb-2">
        <h4>Value Reconciliation</h4>
        <div className="enc-grid-8">
          <div className="enc-field bg-[#f0f5ff]">
            <label>Appraised Value</label>
            <div className="v text-[#0a52a0] font-bold">{money(appraisal.appraisedValue)}</div>
          </div>
          <div className="enc-field">
            <label>Sales Price</label>
            <div className="v">{salesPrice != null ? money(salesPrice) : "—"}</div>
          </div>
          <div className="enc-field">
            <label>Difference</label>
            <div className={"v " + (difference != null && difference < 0 ? "text-[#c00] font-bold" : "")}>
              {difference != null ? (difference >= 0 ? "+" : "") + money(difference) : "—"}
            </div>
          </div>
          <div className="enc-field">
            <label>Value Flag</label>
            <div className={"v " + valueFlagColor}>{valueFlag}</div>
          </div>
          <div className="enc-field"><label>LTV</label><div className="v">{transaction.ltv}%</div></div>
          <div className="enc-field"><label>CLTV</label><div className="v">{transaction.cltv}%</div></div>
          <div className="enc-field"><label>HCLTV</label><div className="v">{transaction.hcltv}%</div></div>
          <div className="enc-field" />
        </div>
      </div>

      {/* Comparables Table */}
      <div className="enc-sec">
        <h4>Comparable Sales ({sorted.length})</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead className="bg-gradient-to-b from-[#e2ddc7] to-[#cfc9ae] border-y border-[#6b7a8f]">
              <tr>
                <th className="px-2 py-[2px] text-left w-6">#</th>
                <SortHeader label="Address" sortKey="address" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Sale Price" sortKey="salePrice" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Sale Date" sortKey="saleDate" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Sq Ft" sortKey="sqft" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Distance" sortKey="distance" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Adj Value" sortKey="adjustedValue" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Adj Diff" sortKey="adjDiff" current={sortKey} dir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-2 text-center text-[#888] italic">
                    No comparables on file
                  </td>
                </tr>
              ) : (
                sorted.map((c, i) => {
                  const diff = adjDiff(c);
                  return (
                    <tr
                      key={c.address}
                      className={"border-b border-dotted border-[#dcd7c0] " + (i % 2 === 0 ? "bg-white" : "bg-[#f7f5ee]")}
                    >
                      <td className="px-2 py-[1px] text-[#888]">{i + 1}</td>
                      <td className="px-2 py-[1px]">{c.address}</td>
                      <td className="px-2 py-[1px] text-right">{money(c.salePrice)}</td>
                      <td className="px-2 py-[1px]">{c.saleDate}</td>
                      <td className="px-2 py-[1px] text-right">{c.sqft.toLocaleString()}</td>
                      <td className="px-2 py-[1px]">{c.distance}</td>
                      <td className="px-2 py-[1px] text-right font-medium">{money(c.adjustedValue)}</td>
                      <td className={"px-2 py-[1px] text-right " + (diff < 0 ? "text-[#c00]" : diff > 0 ? "text-[#006400]" : "")}>
                        {diff >= 0 ? "+" : ""}{money(diff)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
