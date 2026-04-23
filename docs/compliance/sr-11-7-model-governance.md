# Model Governance — LLM Insight Generator

**Model Name:** Guideline Change Suggestion Generator
**Tier:** Tier 2 (Informational — requires human approval)
**Owner:** Platform Engineering
**Last Review:** 2026-04-23

## Purpose
Analyzes UW override patterns and proposes specific guideline or prompt changes to improve agent-UW alignment.

## Inputs
- PII-redacted override samples (max 10, k-anonymized)
- Active tenant guideline rules (JSON)
- Pattern detection metrics snapshot

## Outputs
- Structured suggestion: operation, path, from, to, scope
- Confidence score (0-1)
- Root cause analysis
- Risk assessment

## Consumers
- Tenant admin (first-key approval)
- Compliance officer (second-key for guideline/threshold changes)

## Validation
1. Schema validation via Zod
2. Guideline compatibility (path exists, type-compatible, stale-view)
3. Threshold reasonableness (DTI ≤65%, FICO ≥500, LTV ≤97%, etc.)
4. Fair-lending minimal screen (geographic proxy, 5pp delta)

## Monitoring
- Per-pattern acceptance rate (learning_outcomes table)
- Suggestion type distribution drift
- LLM cost per tenant per day
- Validation failure rate
- Model selection distribution (Haiku vs Sonnet)

## Override Policy
- Two-key approval for guideline changes (admin + compliance_officer)
- Single-key for prompt adjustments (admin, compliance notified)
- Compliance officer has absolute veto
- All decisions logged to learning_outcomes

## Data Handling
- PII redaction: layered (regex + k-anonymity)
- Per-record redaction manifest stored on suggestion
- Anthropic zero-data-retention header
- No tenant data used for model training

## Revalidation Triggers
- Annual review
- Guideline schema change
- Model version upgrade
- Acceptance rate drops below 40% (30-day window)
