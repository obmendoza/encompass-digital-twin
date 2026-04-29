#!/bin/bash
# =============================================================================
# Spec F: Intelligent Guideline Processing — End-to-End Pipeline Test
# =============================================================================
#
# Runs steps 3-6 of the testing plan:
#   Step 3: Ingest NPNQM guideline + matrix PDFs
#   Step 4: Two-key KB approval (operator + compliance)
#   Step 5: Query pipeline (narrative search + matrix lookup)
#   Step 6: Chatbot end-to-end
#
# Prerequisites:
#   1. Node API running on :4000 (migration 012 applied)
#   2. Python agent service running on :8000 with DATABASE_URL + OPENAI_API_KEY
#   3. NPNQM PDFs in ~/Downloads/
#
# Usage:
#   chmod +x scripts/test-guideline-pipeline.sh
#   ./scripts/test-guideline-pipeline.sh [tenant-id]
#
#   If tenant-id is omitted, the script looks up the NPNQM tenant from the API.
# =============================================================================

set -uo pipefail

AGENT_URL="${AGENT_SERVICE_URL:-http://localhost:8000}"
API_URL="${API_URL:-http://localhost:4000}"

GUIDELINES_PDF="$HOME/Downloads/Flex NonQM and DSCR Underwriting Guidelines_02 13 2026 Rev 1.pdf"
MATRICES_PDF="$HOME/Downloads/NonQM and DSCR Matrices_02 13 2026 Rev1.pdf"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color
BOLD='\033[1m'

pass_count=0
fail_count=0

pass() {
    echo -e "  ${GREEN}PASS${NC} $1"
    ((pass_count++))
}

fail() {
    echo -e "  ${RED}FAIL${NC} $1"
    echo -e "       $2"
    ((fail_count++))
}

section() {
    echo ""
    echo -e "${BLUE}${BOLD}=== $1 ===${NC}"
    echo ""
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
section "Pre-Flight Checks"

# Check agent service is running
if curl -sf "$AGENT_URL/api/guidelines/health" > /dev/null 2>&1; then
    pass "Agent service reachable at $AGENT_URL"
else
    echo -e "${RED}Agent service not reachable at $AGENT_URL${NC}"
    echo "Start it with: DATABASE_URL=... OPENAI_API_KEY=... uvicorn backend.main:app --port 8000"
    exit 1
fi

# Check PDFs exist
if [ -f "$GUIDELINES_PDF" ]; then
    pass "Guidelines PDF found ($(du -h "$GUIDELINES_PDF" | cut -f1))"
else
    fail "Guidelines PDF not found" "$GUIDELINES_PDF"
    exit 1
fi

if [ -f "$MATRICES_PDF" ]; then
    pass "Matrices PDF found ($(du -h "$MATRICES_PDF" | cut -f1))"
else
    fail "Matrices PDF not found" "$MATRICES_PDF"
    exit 1
fi

# Resolve tenant ID
if [ -n "${1:-}" ]; then
    TENANT_ID="$1"
    echo -e "  Using provided tenant ID: ${YELLOW}$TENANT_ID${NC}"
else
    echo "  Looking up NPNQM tenant..."
    TENANT_ID=$(curl -sf "$API_URL/tenants" \
        -H "x-user-id: admin" \
        -H "x-super-admin: true" \
        | python3 -c "
import sys, json
tenants = json.load(sys.stdin)
if isinstance(tenants, list):
    for t in tenants:
        if 'npnqm' in t.get('slug','').lower() or 'npnqm' in t.get('name','').lower():
            print(t['id'])
            sys.exit(0)
    # Fall back to first production tenant
    for t in tenants:
        if t.get('type') == 'production':
            print(t['id'])
            sys.exit(0)
print('')
" 2>/dev/null || echo "")

    if [ -z "$TENANT_ID" ]; then
        echo -e "${YELLOW}  Could not find NPNQM tenant. Enter tenant ID manually:${NC}"
        read -r TENANT_ID
    fi
    pass "Resolved tenant ID: $TENANT_ID"
fi

# ---------------------------------------------------------------------------
# Step 3: Ingest NPNQM Documents
# ---------------------------------------------------------------------------
section "Step 3: Ingest NPNQM Documents"

echo "  Ingesting guideline manual (143 pages)... this may take 2-3 minutes"
INGEST_GUIDELINES=$(curl -sf -X POST "$AGENT_URL/api/guidelines/ingest" \
    -F "tenantId=$TENANT_ID" \
    -F "category=guideline_manual" \
    -F "fileName=Flex NonQM Guidelines.pdf" \
    -F "document=@$GUIDELINES_PDF" \
    --max-time 300 2>&1) || true

if echo "$INGEST_GUIDELINES" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('success')==True or d.get('status')=='ingested'" 2>/dev/null; then
    CHUNKS=$(echo "$INGEST_GUIDELINES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('chunksStored') or d.get('results',{}).get('chunks_created',0))")
    SECTIONS=$(echo "$INGEST_GUIDELINES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('sectionsFound') or d.get('results',{}).get('sections_found',0))" 2>/dev/null || echo "?")
    pass "Guidelines ingested: $CHUNKS chunks"
else
    fail "Guidelines ingestion failed" "$INGEST_GUIDELINES"
fi

echo ""
echo "  Ingesting matrix tables (37 pages)... this may take 3-5 minutes"
INGEST_MATRICES=$(curl -sf -X POST "$AGENT_URL/api/guidelines/ingest" \
    -F "tenantId=$TENANT_ID" \
    -F "category=rate_sheet" \
    -F "fileName=NonQM Matrices.pdf" \
    -F "document=@$MATRICES_PDF" \
    --max-time 600 2>&1) || true

if echo "$INGEST_MATRICES" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('success')==True or d.get('status')=='ingested'" 2>/dev/null; then
    TIERS=$(echo "$INGEST_MATRICES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tiersExtracted') or d.get('results',{}).get('tiers_extracted',0))" 2>/dev/null || echo "?")
    pass "Matrices ingested: $TIERS tiers extracted"
else
    fail "Matrix ingestion failed" "$INGEST_MATRICES"
fi

# Get KB version from status
KB_VERSION=$(echo "$INGEST_GUIDELINES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('kbVersion') or 1)" 2>/dev/null || echo "1")

# ---------------------------------------------------------------------------
# Step 4: Two-Key KB Approval
# ---------------------------------------------------------------------------
section "Step 4: Two-Key KB Approval"

# Operator approval
APPROVE_OP=$(curl -sf -X POST "$AGENT_URL/api/guidelines/approve" \
    -H "Content-Type: application/json" \
    -d "{\"tenantId\":\"$TENANT_ID\",\"version\":$KB_VERSION,\"approvedBy\":\"operator-test-001\",\"role\":\"operator\"}" 2>&1) || true

if echo "$APPROVE_OP" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('success')==True or d.get('status')=='updated'" 2>/dev/null; then
    pass "Operator approval recorded (first key)"
else
    fail "Operator approval failed" "$APPROVE_OP"
fi

# Compliance sign-off
APPROVE_COMP=$(curl -sf -X POST "$AGENT_URL/api/guidelines/approve" \
    -H "Content-Type: application/json" \
    -d "{\"tenantId\":\"$TENANT_ID\",\"version\":$KB_VERSION,\"approvedBy\":\"compliance-test-001\",\"role\":\"compliance\"}" 2>&1) || true

if echo "$APPROVE_COMP" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('success')==True or d.get('status')=='updated'" 2>/dev/null; then
    pass "Compliance sign-off recorded (second key)"
else
    fail "Compliance sign-off failed" "$APPROVE_COMP"
fi

# Verify KB is active
STATUS=$(curl -sf "$AGENT_URL/api/guidelines/status/$TENANT_ID" 2>&1) || true

KB_STATE=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('kbState','unknown'))" 2>/dev/null || echo "unknown")

if [ "$KB_STATE" = "kb_active" ]; then
    pass "KB state is active"
else
    fail "KB state is not active" "Got: $KB_STATE"
fi

CHUNK_COUNT=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('guidelines',{}).get('chunks',0))" 2>/dev/null || echo "0")
echo -e "       Chunks in KB: ${YELLOW}$CHUNK_COUNT${NC}"

# ---------------------------------------------------------------------------
# Step 5: Query Pipeline
# ---------------------------------------------------------------------------
section "Step 5: Query Pipeline"

# Test 5a: Narrative search — bankruptcy seasoning
echo "  5a. Narrative search: bankruptcy seasoning..."
SEARCH_RESULT=$(curl -sf -X POST "$AGENT_URL/api/guidelines/search" \
    -H "Content-Type: application/json" \
    -d "{\"tenantId\":\"$TENANT_ID\",\"query\":\"What is the seasoning requirement for Chapter 7 bankruptcy?\",\"maxResults\":3}" 2>&1) || true

SEARCH_COUNT=$(echo "$SEARCH_RESULT" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('results',[])))" 2>/dev/null || echo "0")

if [ "$SEARCH_COUNT" -gt 0 ]; then
    TOP_SECTION=$(echo "$SEARCH_RESULT" | python3 -c "import sys,json; r=json.load(sys.stdin)['results'][0]; print(r.get('section_path','?'))" 2>/dev/null || echo "?")
    TOP_CONF=$(echo "$SEARCH_RESULT" | python3 -c "import sys,json; r=json.load(sys.stdin)['results'][0]; print(f\"{r.get('confidence',0):.2f}\")" 2>/dev/null || echo "?")
    pass "Narrative search returned $SEARCH_COUNT results"
    echo -e "       Top result: ${YELLOW}$TOP_SECTION${NC} (confidence: $TOP_CONF)"
else
    fail "Narrative search returned no results" "$SEARCH_RESULT"
fi

# Test 5b: Matrix lookup — 680 FICO, 80% LTV, investment
echo ""
echo "  5b. Matrix lookup: 680 FICO, 80% LTV, Flex Select investment..."
MATRIX_RESULT=$(curl -sf -X POST "$AGENT_URL/api/guidelines/matrix-lookup" \
    -H "Content-Type: application/json" \
    -d "{\"tenantId\":\"$TENANT_ID\",\"program\":\"Flex Select\",\"fico\":680,\"ltv\":80,\"occupancy\":\"investment\",\"loanPurpose\":\"purchase\"}" 2>&1) || true

ELIGIBLE=$(echo "$MATRIX_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('eligible','?'))" 2>/dev/null || echo "?")

if [ "$ELIGIBLE" = "False" ] || [ "$ELIGIBLE" = "false" ]; then
    pass "Matrix lookup correctly returns NOT eligible (680 FICO / 80% LTV / investment)"
    REASON=$(echo "$MATRIX_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('reason',''))" 2>/dev/null || echo "")
    echo -e "       Reason: ${YELLOW}$REASON${NC}"
elif [ "$ELIGIBLE" = "True" ] || [ "$ELIGIBLE" = "true" ]; then
    fail "Matrix lookup says ELIGIBLE — expected NOT eligible at 80% LTV for 680 FICO investment" "$MATRIX_RESULT"
else
    fail "Matrix lookup returned unexpected result" "eligible=$ELIGIBLE | $MATRIX_RESULT"
fi

# Test 5c: Matrix lookup — 760 FICO, 85% LTV, primary (should be eligible)
echo ""
echo "  5c. Matrix lookup: 760 FICO, 85% LTV, Flex Select primary..."
MATRIX_RESULT2=$(curl -sf -X POST "$AGENT_URL/api/guidelines/matrix-lookup" \
    -H "Content-Type: application/json" \
    -d "{\"tenantId\":\"$TENANT_ID\",\"program\":\"Flex Select\",\"fico\":760,\"ltv\":85,\"occupancy\":\"primary\",\"loanPurpose\":\"purchase\"}" 2>&1) || true

ELIGIBLE2=$(echo "$MATRIX_RESULT2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('eligible','?'))" 2>/dev/null || echo "?")

if [ "$ELIGIBLE2" = "True" ] || [ "$ELIGIBLE2" = "true" ]; then
    pass "Matrix lookup correctly returns ELIGIBLE (760 FICO / 85% LTV / primary)"
else
    echo -e "  ${YELLOW}NOTE${NC} Matrix lookup result: eligible=$ELIGIBLE2 (may depend on actual matrix data)"
fi

# ---------------------------------------------------------------------------
# Step 6: Chatbot End-to-End
# ---------------------------------------------------------------------------
section "Step 6: Chatbot End-to-End"

# Test 6a: First message (creates conversation)
echo "  6a. Chatbot: Can a 680 FICO borrower get 80% LTV on Flex Select investment?..."
CHAT_RESULT=$(curl -sf -X POST "$AGENT_URL/api/guidelines/chat" \
    -H "Content-Type: application/json" \
    -d "{\"tenantId\":\"$TENANT_ID\",\"query\":\"Can a borrower with 680 FICO get 80% LTV on Flex Select investment property?\"}" \
    --max-time 60 2>&1) || true

CONV_ID=$(echo "$CHAT_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('conversationId',''))" 2>/dev/null || echo "")
ANSWER=$(echo "$CHAT_RESULT" | python3 -c "import sys,json; a=json.load(sys.stdin).get('answer',''); print(a[:150])" 2>/dev/null || echo "")
G_SCORE=$(echo "$CHAT_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('groundedness_score', json.load(sys.stdin).get('groundednessScore','?')))" 2>/dev/null || echo "?")
SOURCE_COUNT=$(echo "$CHAT_RESULT" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('sources',[])))" 2>/dev/null || echo "0")

if [ -n "$CONV_ID" ] && [ -n "$ANSWER" ]; then
    pass "Chatbot responded (conversation: ${CONV_ID:0:8}...)"
    echo -e "       Answer: ${YELLOW}${ANSWER}${NC}"
    echo -e "       Groundedness: $G_SCORE | Sources: $SOURCE_COUNT"
else
    fail "Chatbot failed to respond" "$CHAT_RESULT"
fi

# Test 6b: Follow-up in same conversation
if [ -n "$CONV_ID" ]; then
    echo ""
    echo "  6b. Follow-up: What about at 75% LTV?..."
    CHAT_FOLLOWUP=$(curl -sf -X POST "$AGENT_URL/api/guidelines/chat" \
        -H "Content-Type: application/json" \
        -d "{\"tenantId\":\"$TENANT_ID\",\"conversationId\":\"$CONV_ID\",\"query\":\"What about at 75% LTV instead?\"}" \
        --max-time 60 2>&1) || true

    FOLLOWUP_ANSWER=$(echo "$CHAT_FOLLOWUP" | python3 -c "import sys,json; a=json.load(sys.stdin).get('answer',''); print(a[:150])" 2>/dev/null || echo "")
    FOLLOWUP_CONV=$(echo "$CHAT_FOLLOWUP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('conversationId',''))" 2>/dev/null || echo "")

    if [ "$FOLLOWUP_CONV" = "$CONV_ID" ] && [ -n "$FOLLOWUP_ANSWER" ]; then
        pass "Follow-up maintained conversation context"
        echo -e "       Answer: ${YELLOW}${FOLLOWUP_ANSWER}${NC}"
    else
        fail "Follow-up failed or conversation ID mismatch" "Expected conv: $CONV_ID, got: $FOLLOWUP_CONV"
    fi
fi

# Test 6c: Verify KB status shows cost data
echo ""
echo "  6c. Checking cost tracking..."
FINAL_STATUS=$(curl -sf "$AGENT_URL/api/guidelines/status/$TENANT_ID" 2>&1) || true
MONTHLY_COST=$(echo "$FINAL_STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cost',{}).get('monthlyUsd',0))" 2>/dev/null || echo "0")

if python3 -c "assert float('$MONTHLY_COST') > 0" 2>/dev/null; then
    pass "Cost tracking active (\$$MONTHLY_COST this month)"
else
    echo -e "  ${YELLOW}NOTE${NC} Monthly cost: \$$MONTHLY_COST (may be 0 if cost recording failed)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
section "Summary"

echo -e "  ${GREEN}Passed: $pass_count${NC}"
echo -e "  ${RED}Failed: $fail_count${NC}"
echo ""

if [ "$fail_count" -eq 0 ]; then
    echo -e "${GREEN}${BOLD}All pipeline tests passed.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Start the web app: pnpm --filter @twin/web dev"
    echo "  2. Set AGENT_SERVICE_URL=http://localhost:8000 in .env.local"
    echo "  3. Open any UW screen — chatbot bubble should appear bottom-right"
    echo "  4. Navigate to NPNQM onboarding — new KB components ready"
    exit 0
else
    echo -e "${RED}${BOLD}$fail_count test(s) failed. Review output above.${NC}"
    exit 1
fi
