# Complete Document Requirements for Non-QM Loans (NQMF)

**Engine-synced**: Generated from `validate_minimum_documents` + `validate_income_documentation` in `eligibility_check_v2.py` (same messages `main.py` uses when evaluating each program) on **2026-05-11 08:15:02**.
Scenarios omit all `Has_*` document booleans so the engine reports missing items using the same `Missing base documents:` and `Required documents:` pipe-lists as production output.

---

## 1. How to read this document

- **Minimum required documents**: From `Minimum Required Documents` → `Missing base documents: …` (pipe-separated display names).
- **Income documentation**: From `Income Documentation (…)` → `Required documents: …`.
- **Programs**: Flex Select (standard US citizen paths), Foreign National, Select ITIN (`is_select_itin` true).
- **Baseline**: Purchase, Wholesale, First Lien, CA / Los Angeles, `LLCOrLegalEntity` false, unless overridden.

### Engine rules (minimum docs)

| Rule | Behavior |
|------|----------|
| LLC closing documents | Only when `LLCOrLegalEntity` is true and occupancy is investment-type; not added for DSCR programs (Investor DSCR, DSCR Supreme, DSCR Multi, Investor DSCR No Ratio). |
| Field Review | When `State` is NY and `County` is Brooklyn or Kings and occupancy is investment-type. Schema key: `Field review` (`Has_Field_Review`). |
| US credit | If `USCredit` is false, credit report is removed from the minimum-doc set. |

---

## 2. Document output by income scenario

### Full Doc (W2)

**Resolved Neo4j income type**: `Full Documentation - Wage Earner`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Most recent paystub(s) reflecting 30 days of pay
2. Most recent 2 years W2

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Most recent paystub(s) reflecting 30 days of pay | Most recent 2 years W2`

</details>

---

### Full Doc (Self-Employed)

**Resolved Neo4j income type**: `Full Documentation - Self Employed`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years' Self Employment
2. 2 years most recent tax returns (business and personal w/ all schedules)

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years' Self Employment | 2 years most recent tax returns (business and personal w/ all schedules)`

</details>

---

### Full Doc: 12 Mo. (Limited) (W2)

**Resolved Neo4j income type**: `Full Documentation Limited - Wage Earner`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Most recent paystub(s) reflecting 30 days of pay
2. Most recent 1 year W2

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Most recent paystub(s) reflecting 30 days of pay | Most recent 1 year W2`

</details>

---

### Full Doc: 12 Mo. (Limited) (Self-Employed)

**Resolved Neo4j income type**: `Full Documentation Limited - Self Employed`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years' Self Employment
2. 1 year most recent tax returns (business and personal w/ all schedules)

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years' Self Employment | 1 year most recent tax returns (business and personal w/ all schedules)`

</details>

---

### 1099: 12 Mo. (Self-Employed)

**Resolved Neo4j income type**: `1099 - 12 Months`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. 1 year most recent 1099 statements
2. Proof of YTD income if 1099 is > 90 days from note date (bank statements or employer printout)

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: 1 year most recent 1099 statements | Proof of YTD income if 1099 is > 90 days from note date (bank statements or employer printout)`

</details>

---

### 1099: 24 mo. (Self-Employed)

**Resolved Neo4j income type**: `1099 - 24 Months`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. 2 years' most recent 1099 statements
2. Proof of YTD income if 1099 is > 90 days from note date (bank statements or employer printout)

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: 2 years' most recent 1099 statements | Proof of YTD income if 1099 is > 90 days from note date (bank statements or employer printout)`

</details>

---

### Bank Stmts: 12 Mo. Personal (Self-Employed)

**Resolved Neo4j income type**: `Bank Statement - 12 Mo. Personal`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business)
2. 12 months' most recent personal bank statements
3. Proof of 2 years' self-employment
4. 2 months most recent business bank statements
5. 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied)
6. Proof of Borrower(s) ownership percentage

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business) | 12 months' most recent personal bank statements | Proof of 2 years' self-employment | 2 months most recent business bank statements | 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied) | Proof of Borrower(s) ownership percentage`

</details>

---

### Bank Stmts: 12 Mo. Business (Self-Employed)

**Resolved Neo4j income type**: `Bank Statement - 12 Mo. Business`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years' self-employment
2. Proof of Borrower(s) ownership percentage
3. 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied)
4. Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business)
5. 12 months' most recent business bank statements

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years' self-employment | Proof of Borrower(s) ownership percentage | 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied) | Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business) | 12 months' most recent business bank statements`

</details>

---

### Bank Stmts: 24 Mo. Personal (Self-Employed)

**Resolved Neo4j income type**: `Bank Statement - 24 Mo. Personal`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years' self-employment
2. 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied)
3. Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business)
4. 24 months' most recent personal bank statements
5. Proof of Borrower(s) ownership percentage
6. 2 months most recent business bank statements

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years' self-employment | 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied) | Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business) | 24 months' most recent personal bank statements | Proof of Borrower(s) ownership percentage | 2 months most recent business bank statements`

</details>

---

### Bank Stmts: 24 Mo. Business (Self-Employed)

**Resolved Neo4j income type**: `Bank Statement - 24 Mo. Business`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years' self-employment
2. 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied)
3. Proof of Borrower(s) ownership percentage
4. 24 months' most recent business bank statements
5. Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business)

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years' self-employment | 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied) | Proof of Borrower(s) ownership percentage | 24 months' most recent business bank statements | Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business)`

</details>

---

### PnL: 12 Mo. CPA Prepared (Self-Employed)

**Resolved Neo4j income type**: `PnL - 12 Mo. CPA Prepared`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years Self Employment
2. Proof of Borrower's ownership percentage
3. 12 months most recent 3rd party P&L statements

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years Self Employment | Proof of Borrower's ownership percentage | 12 months most recent 3rd party P&L statements`

</details>

---

### PnL 24 Mo. CPA Prepared (Self-Employed)

**Resolved Neo4j income type**: `PnL - 24 Mo. CPA Prepared`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years Self Employment
2. Proof of Borrower's ownership percentage
3. 24 months most recent 3rd party P&L statements

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years Self Employment | Proof of Borrower's ownership percentage | 24 months most recent 3rd party P&L statements`

</details>

---

### 12 Mo. PnL w/ Bank Statement (Self-Employed)

**Resolved Neo4j income type**: `PnL - 12 Mo. w/ Bank Statement`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years Self Employment
2. Proof of Borrower's ownership percentage
3. 12 months most recent 3rd party P&L statements
4. Minimum of 2 months business bank statements

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years Self Employment | Proof of Borrower's ownership percentage | 12 months most recent 3rd party P&L statements | Minimum of 2 months business bank statements`

</details>

---

### 24 Mo. PnL w/ Bank Statements (Self-Employed)

**Resolved Neo4j income type**: `PnL - 24 Mo. w/ Bank Statement`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years Self Employment
2. Proof of Borrower's ownership percentage
3. 24 months most recent 3rd party P&L statements
4. Minimum of 2 months business bank statements

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years Self Employment | Proof of Borrower's ownership percentage | 24 months most recent 3rd party P&L statements | Minimum of 2 months business bank statements`

</details>

---

### DSCR / No Ratio DSCR

**Resolved Neo4j income type**: `DSCR`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of Rental Income: Current Lease or 1007

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of Rental Income: Current Lease or 1007`

</details>

---

### Asset Utilization

**Resolved Neo4j income type**: `Asset Utilization`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. 3 months most recent asset statements for all accounts to be used for qualifying

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: 3 months most recent asset statements for all accounts to be used for qualifying`

</details>

---

### Written VOE Only

**Resolved Neo4j income type**: `Written VOE Only`
**Program (validation context)**: `Flex Select`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. WVOE directly from the employer (email or fax)
2. 2 months' most recent bank statements reflecting deposit amounts from the employer

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: WVOE directly from the employer (email or fax) | 2 months' most recent bank statements reflecting deposit amounts from the employer`

</details>

---

### Foreign National — Full Doc (W2)

**Resolved Neo4j income type**: `Foreign National - Full Doc Wage Earner`
**Program (validation context)**: `Foreign National`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Valid Unexpired Passport & VISA
2. One of the following: Current, YTD and previous 2 years earnings documentation from the country of origin OR WVOE or Letter from employer documenting current salary, previous 2 years' & YTD Income

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Valid Unexpired Passport & VISA | One of the following: Current, YTD and previous 2 years earnings documentation from the country of origin OR WVOE or Letter from employer documenting current salary, previous 2 years' & YTD Income`

</details>

---

### Foreign National — Full Doc (Self-Employed)

**Resolved Neo4j income type**: `Foreign National - Full Doc Self Employed`
**Program (validation context)**: `Foreign National`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Valid Unexpired Passport & VISA
2. CPA Letter with 2 years' most recent income & YTD Earnings
3. Proof of 2 years Self Employment

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Valid Unexpired Passport & VISA | CPA Letter with 2 years' most recent income & YTD Earnings | Proof of 2 years Self Employment`

</details>

---

### Foreign National — Asset Utilization

**Resolved Neo4j income type**: `Foreign National - Asset Utilization`
**Program (validation context)**: `Foreign National`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Valid Unexpired Passport & VISA
2. Most Recent 3 months asset statements for all accounts to be used for qualifying

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Valid Unexpired Passport & VISA | Most Recent 3 months asset statements for all accounts to be used for qualifying`

</details>

---

### Foreign National — DSCR / No Ratio DSCR

**Resolved Neo4j income type**: `Foreign National - DSCR`
**Program (validation context)**: `Foreign National`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Valid Unexpired Passport & VISA
2. Proof of Rental Income: Current Lease or 1007

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Valid Unexpired Passport & VISA | Proof of Rental Income: Current Lease or 1007`

</details>

---

### ITIN — Full Doc (W2)

**Resolved Neo4j income type**: `ITIN - Full Doc Wage Earner`
**Program (validation context)**: `Select ITIN`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. ITIN Approval Letter (CP-565)
2. Unexpired ID (VISA, Passport or Driver's License)
3. WVOE proving most recent 1-2 years previous income
4. 1 or 2 years most recent tax returns

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: ITIN Approval Letter (CP-565) | Unexpired ID (VISA, Passport or Driver's License) | WVOE proving most recent 1-2 years previous income | 1 or 2 years most recent tax returns`

</details>

---

### ITIN — Full Doc (Self-Employed)

**Resolved Neo4j income type**: `ITIN - Full Doc Self Employed`
**Program (validation context)**: `Select ITIN`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years' Self Employment
2. 1 or 2 years most recent tax returns (business and personal w/ all schedules)
3. ITIN Approval Letter (CP-565)
4. Unexpired ID (VISA, Passport or Driver's License)

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years' Self Employment | 1 or 2 years most recent tax returns (business and personal w/ all schedules) | ITIN Approval Letter (CP-565) | Unexpired ID (VISA, Passport or Driver's License)`

</details>

---

### ITIN — Full Doc: 12 Mo. (Limited) (W2)

**Resolved Neo4j income type**: `ITIN - Full Doc Limited Wage Earner`
**Program (validation context)**: `Select ITIN`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. ITIN Approval Letter (CP-565)
2. Unexpired ID (VISA, Passport or Driver's License)
3. WVOE proving most recent 1 year previous income
4. 1 year most recent tax returns

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: ITIN Approval Letter (CP-565) | Unexpired ID (VISA, Passport or Driver's License) | WVOE proving most recent 1 year previous income | 1 year most recent tax returns`

</details>

---

### ITIN — Full Doc: 12 Mo. (Limited) (Self-Employed)

**Resolved Neo4j income type**: `ITIN - Full Doc Limited Self Employed`
**Program (validation context)**: `Select ITIN`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. ITIN Approval Letter (CP-565)
2. Unexpired ID (VISA, Passport or Driver's License)
3. 1 year most recent tax returns (business and personal w/ all schedules)
4. Proof of 2 years' Self Employment

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: ITIN Approval Letter (CP-565) | Unexpired ID (VISA, Passport or Driver's License) | 1 year most recent tax returns (business and personal w/ all schedules) | Proof of 2 years' Self Employment`

</details>

---

### ITIN — Bank Stmts: 12 Mo. Personal (Self-Employed)

**Resolved Neo4j income type**: `ITIN - Bank Statement 12 Mo. Personal`
**Program (validation context)**: `Select ITIN`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years ITIN payments to the IRS - see guidelines for acceptable evidence
2. ITIN Approval Letter (CP-565)
3. Unexpired ID (VISA, Passport or Driver's License)
4. Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business)
5. 12 months' most recent personal bank statements
6. Proof of 2 years' self-employment
7. 2 months most recent business bank statements
8. 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied)
9. Proof of Borrower(s) ownership percentage

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years ITIN payments to the IRS - see guidelines for acceptable evidence | ITIN Approval Letter (CP-565) | Unexpired ID (VISA, Passport or Driver's License) | Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business) | 12 months' most recent personal bank statements | Proof of 2 years' self-employment | 2 months most recent business bank statements | 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied) | Proof of Borrower(s) ownership percentage`

</details>

---

### ITIN — Bank Stmts: 12 Mo. Business (Self-Employed)

**Resolved Neo4j income type**: `ITIN - Bank Statement 12 Mo. Business`
**Program (validation context)**: `Select ITIN`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years ITIN payments to the IRS - see guidelines for acceptable evidence
2. ITIN Approval Letter (CP-565)
3. Unexpired ID (VISA, Passport or Driver's License)
4. Proof of 2 years' self-employment
5. Proof of Borrower(s) ownership percentage
6. 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied)
7. Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business)
8. 12 months' most recent business bank statements

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years ITIN payments to the IRS - see guidelines for acceptable evidence | ITIN Approval Letter (CP-565) | Unexpired ID (VISA, Passport or Driver's License) | Proof of 2 years' self-employment | Proof of Borrower(s) ownership percentage | 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied) | Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business) | 12 months' most recent business bank statements`

</details>

---

### ITIN — Bank Stmts: 24 Mo. Personal (Self-Employed)

**Resolved Neo4j income type**: `ITIN - Bank Statement 24 Mo. Personal`
**Program (validation context)**: `Select ITIN`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years ITIN payments to the IRS - see guidelines for acceptable evidence
2. ITIN Approval Letter (CP-565)
3. Unexpired ID (VISA, Passport or Driver's License)
4. Proof of 2 years' self-employment
5. 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied)
6. Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business)
7. 24 months' most recent personal bank statements
8. Proof of Borrower(s) ownership percentage
9. 2 months most recent business bank statements

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years ITIN payments to the IRS - see guidelines for acceptable evidence | ITIN Approval Letter (CP-565) | Unexpired ID (VISA, Passport or Driver's License) | Proof of 2 years' self-employment | 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied) | Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business) | 24 months' most recent personal bank statements | Proof of Borrower(s) ownership percentage | 2 months most recent business bank statements`

</details>

---

### ITIN — Bank Stmts: 24 Mo. Business (Self-Employed)

**Resolved Neo4j income type**: `ITIN - Bank Statement 24 Mo. Business`
**Program (validation context)**: `Select ITIN`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of 2 years ITIN payments to the IRS - see guidelines for acceptable evidence
2. ITIN Approval Letter (CP-565)
3. Unexpired ID (VISA, Passport or Driver's License)
4. Proof of 2 years' self-employment
5. 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied)
6. Proof of Borrower(s) ownership percentage
7. 24 months' most recent business bank statements
8. Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business)

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of 2 years ITIN payments to the IRS - see guidelines for acceptable evidence | ITIN Approval Letter (CP-565) | Unexpired ID (VISA, Passport or Driver's License) | Proof of 2 years' self-employment | 3rd Party Expense Statement or P&L (Note: If 3rd Party Statement is not provided, 50% Expense Ratio will be applied) | Proof of Borrower(s) ownership percentage | 24 months' most recent business bank statements | Completed LGX Bank Statement Analysis OR Completed NQMF Business Narrative Form (one for each business)`

</details>

---

### ITIN — 1099: 12 Mo. (Self-Employed)

**Resolved Neo4j income type**: `ITIN - 1099 (12 Months)`
**Program (validation context)**: `Select ITIN`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Proof of YTD income if 1099 is > 90 days from note date (bank statement or employer printout) (Note: Required if 1099 is > 90 days from note date)
2. ITIN Approval Letter (CP-565)
3. Unexpired ID (VISA, Passport or Driver's License)
4. Proof of 2 years ITIN payments to the IRS will be required - see guidelines for acceptable evidence (Note: Refer to guidelines for acceptable evidence)
5. Most Recent 1 year 1099 statements

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Proof of YTD income if 1099 is > 90 days from note date (bank statement or employer printout) (Note: Required if 1099 is > 90 days from note date) | ITIN Approval Letter (CP-565) | Unexpired ID (VISA, Passport or Driver's License) | Proof of 2 years ITIN payments to the IRS will be required - see guidelines for acceptable evidence (Note: Refer to guidelines for acceptable evidence) | Most Recent 1 year 1099 statements`

</details>

---

### ITIN — 1099: 24 mo. (Self-Employed)

**Resolved Neo4j income type**: `ITIN - 1099 (24 Months)`
**Program (validation context)**: `Select ITIN`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. ITIN Approval Letter (CP-565)
2. Unexpired ID (VISA, Passport or Driver's License)
3. Proof of YTD income if 1099 is > 90 days from note date (bank statement or employer printout) (Note: Required if 1099 is > 90 days from note date)
4. Proof of 2 years ITIN payments to the IRS will be required - see guidelines for acceptable evidence (Note: Refer to guidelines for acceptable evidence)
5. Most Recent 2 years 1099 statements

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: ITIN Approval Letter (CP-565) | Unexpired ID (VISA, Passport or Driver's License) | Proof of YTD income if 1099 is > 90 days from note date (bank statement or employer printout) (Note: Required if 1099 is > 90 days from note date) | Proof of 2 years ITIN payments to the IRS will be required - see guidelines for acceptable evidence (Note: Refer to guidelines for acceptable evidence) | Most Recent 2 years 1099 statements`

</details>

---

### ITIN — Asset Utilization

**Resolved Neo4j income type**: `ITIN - Asset Utilization`
**Program (validation context)**: `Select ITIN`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

#### Income documentation (engine order)

1. Unexpired ID (VISA, Passport or Driver's License)
2. Proof of 2 years ITIN payments to the IRS - see guidelines for acceptable evidence
3. ITIN Approval Letter (CP-565)
4. 3 months most recent asset statements for all accounts to be used for qualifying

<details><summary>Raw engine messages</summary>

- Minimum: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`
- Income: `Required documents: Unexpired ID (VISA, Passport or Driver's License) | Proof of 2 years ITIN payments to the IRS - see guidelines for acceptable evidence | ITIN Approval Letter (CP-565) | 3 months most recent asset statements for all accounts to be used for qualifying`

</details>

---

## 3. Conditional snapshots

### Conditional: NY Brooklyn + Investment → Field Review (Flex Select)

**Minimum required documents:**
1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure
8. Purchase Contract
9. Copy of EMD Check

**Income documentation:**
1. Most recent paystub(s) reflecting 30 days of pay
2. Most recent 2 years W2

_Raw minimum message: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure | Purchase Contract | Copy of EMD Check`_

---

### Conditional: LLC + Investment → LLC closing set (Flex Select; DSCR programs omit LLC min-docs in engine)

**Minimum required documents:**
1. Initial Loan Application (1003)
2. Credit Report dated within 90 days
3. Most Recent Asset Statement for Proof Reserves
4. Borrower Authorization (when NQMF is pulling credit)
5. Title Fee Sheet
6. LoanNex Product and Pricing Results or Completed Submission Form
7. Anti Steering Disclosure

**Income documentation:**
1. Most recent paystub(s) reflecting 30 days of pay
2. Most recent 2 years W2

_Raw minimum message: `Missing base documents: Initial Loan Application (1003) | Credit Report dated within 90 days | Most Recent Asset Statement for Proof Reserves | Borrower Authorization (when NQMF is pulling credit) | Title Fee Sheet | LoanNex Product and Pricing Results or Completed Submission Form | Anti Steering Disclosure`_

---

## 4. Quick reference: Frontend → resolved Neo4j type

| `IncomeDocType` | `BorrowerType` | `Citizenship` | ITIN | Resolved |
|-----------------|----------------|---------------|------|----------|
| Full Doc | W2 | US Citizen | False | `Full Documentation - Wage Earner` |
| Full Doc | Self-Employed | US Citizen | False | `Full Documentation - Self Employed` |
| Full Doc: 12 Mo. (Limited) | W2 | US Citizen | False | `Full Documentation Limited - Wage Earner` |
| Full Doc: 12 Mo. (Limited) | Self-Employed | US Citizen | False | `Full Documentation Limited - Self Employed` |
| 1099: 12 Mo. | Self-Employed | US Citizen | False | `1099 - 12 Months` |
| 1099: 24 mo. | Self-Employed | US Citizen | False | `1099 - 24 Months` |
| Bank Stmts: 12 Mo. Personal | Self-Employed | US Citizen | False | `Bank Statement - 12 Mo. Personal` |
| Bank Stmts: 12 Mo. Business | Self-Employed | US Citizen | False | `Bank Statement - 12 Mo. Business` |
| Bank Stmts: 24 Mo. Personal | Self-Employed | US Citizen | False | `Bank Statement - 24 Mo. Personal` |
| Bank Stmts: 24 Mo. Business | Self-Employed | US Citizen | False | `Bank Statement - 24 Mo. Business` |
| PnL: 12 Mo. CPA Prepared | Self-Employed | US Citizen | False | `PnL - 12 Mo. CPA Prepared` |
| PnL 24 Mo. CPA Prepared | Self-Employed | US Citizen | False | `PnL - 24 Mo. CPA Prepared` |
| 12 Mo. PnL w/ Bank Statement | Self-Employed | US Citizen | False | `PnL - 12 Mo. w/ Bank Statement` |
| 24 Mo. PnL w/ Bank Statements | Self-Employed | US Citizen | False | `PnL - 24 Mo. w/ Bank Statement` |
| DSCR / No Ratio DSCR | Self-Employed | US Citizen | False | `DSCR` |
| Asset Utilization | W2 | US Citizen | False | `Asset Utilization` |
| Written VOE Only | W2 | US Citizen | False | `Written VOE Only` |
| Full Doc | W2 | Foreign Nationals | False | `Foreign National - Full Doc Wage Earner` |
| Full Doc | Self-Employed | Foreign Nationals | False | `Foreign National - Full Doc Self Employed` |
| Asset Utilization | W2 | Foreign Nationals | False | `Foreign National - Asset Utilization` |
| DSCR / No Ratio DSCR | Self-Employed | Foreign Nationals | False | `Foreign National - DSCR` |
| Full Doc | W2 | US Citizen | True | `ITIN - Full Doc Wage Earner` |
| Full Doc | Self-Employed | US Citizen | True | `ITIN - Full Doc Self Employed` |
| Full Doc: 12 Mo. (Limited) | W2 | US Citizen | True | `ITIN - Full Doc Limited Wage Earner` |
| Full Doc: 12 Mo. (Limited) | Self-Employed | US Citizen | True | `ITIN - Full Doc Limited Self Employed` |
| Bank Stmts: 12 Mo. Personal | Self-Employed | US Citizen | True | `ITIN - Bank Statement 12 Mo. Personal` |
| Bank Stmts: 12 Mo. Business | Self-Employed | US Citizen | True | `ITIN - Bank Statement 12 Mo. Business` |
| Bank Stmts: 24 Mo. Personal | Self-Employed | US Citizen | True | `ITIN - Bank Statement 24 Mo. Personal` |
| Bank Stmts: 24 Mo. Business | Self-Employed | US Citizen | True | `ITIN - Bank Statement 24 Mo. Business` |
| 1099: 12 Mo. | Self-Employed | US Citizen | True | `ITIN - 1099 (12 Months)` |
| 1099: 24 mo. | Self-Employed | US Citizen | True | `ITIN - 1099 (24 Months)` |
| Asset Utilization | W2 | US Citizen | True | `ITIN - Asset Utilization` |

_Generated by `sync_doc_requirements_from_engine.py` at 2026-05-11 08:15:02_
