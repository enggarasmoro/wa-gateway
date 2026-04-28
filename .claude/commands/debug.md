---
description: Systematic debugging protocol — validate root causes through structured hypotheses. Usage: /debug <problem-description>
---

# Debugging Protocol

Problem to debug: **$ARGUMENTS**

## Overview

This protocol moves beyond ad-hoc troubleshooting to a structured process of hypothesis generation and validation. Use it to systematically eliminate potential root causes before applying any fix.

---

## Steps

### 1. Initialise the Session

Create a debugging document using the template at `.claude/skills/debugging-protocol/assets/debugging-session-template.md`.

**Save to:** `docs/debugging/{issue-name}-{YYYY-MM-DD}-{HHmm}.md`

Create `docs/debugging/` if it does not exist. This document can be referenced from other conversations or workflows.

---

### 2. Define the Problem

State clearly:
- **Symptom**: What observable behaviour differs from what is expected?
- **Scope**: Which components are involved?
- **Reproducibility**: Is it consistent, flaky, or a one-off?

---

### 3. Formulate Hypotheses

List distinct, testable hypotheses:
- Avoid vague guesses
- Differentiate between layers (e.g. "Frontend Hypothesis" vs "Backend Hypothesis")
- Example: "Race condition in UI state update" vs "Database schema misconfiguration"

**Write at least 2–3 hypotheses before starting validation.**

---

### 4. Design Validation Tasks

For each hypothesis, design a specific validation task:
- **Objective**: What are you trying to prove or disprove?
- **Steps**: Precise, reproducible actions
- **Code Pattern**: The exact code or command to run
- **Success Criteria**: Explicitly state what output confirms the hypothesis

Examples:
```bash
# Frontend — inspect state
console.log('state before mutation:', JSON.stringify(state))

# Backend — trace request
curl -v -H "X-Debug: true" http://localhost:8080/api/endpoint

# Database — inspect data
SELECT * FROM table WHERE id = 'suspect-id';

# Go — add temporary logging
log.Printf("DEBUG value: %+v", value)
```

---

### 5. Execute and Document

For each hypothesis:
1. Run the validation task
2. Record the actual result vs. the expected result
3. Mark the hypothesis: ✅ Confirmed | ❌ Refuted | ⚠️ Inconclusive
4. If inconclusive — refine the validation task and retry

---

### 6. Root Cause Confirmation

Before declaring a root cause:
- [ ] Can you reproduce the problem consistently?
- [ ] Is the hypothesis confirmed by more than one validation task?
- [ ] Would fixing this root cause resolve the reported symptom?

---

### 7. Fix and Hand Off

Once the root cause is confirmed:
1. Update the debugging document with the conclusion
2. Fix using `/quick-fix` or `/orchestrator` depending on scope
3. Add a test that reproduces the bug (to prevent regression)

---

## Language-Specific Guides

For more detailed debugging patterns per stack:
- Frontend → `.claude/skills/debugging-protocol/languages/frontend.md`
- Rust → `.claude/skills/debugging-protocol/languages/rust.md`

---

## Debugging Document Template

```markdown
# Debugging Session: {issue-name}
**Date:** YYYY-MM-DD HH:mm
**Status:** In Progress | Resolved

## Problem Statement
**Symptom:** ...
**Expected behaviour:** ...
**Actual behaviour:** ...
**Reproducible:** Always / Flaky / Once

## System Context
**Components:** ...
**Environment:** dev / staging / prod
**Recent changes:** ...

## Hypotheses

### Hypothesis 1: {name}
- **Claim:** ...
- **Validation task:** ...
- **Result:** ✅ Confirmed / ❌ Refuted / ⚠️ Inconclusive
- **Evidence:** ...

### Hypothesis 2: {name}
...

## Root Cause
{Confirmed root cause description}

## Fix Applied
{Description of the fix}

## Prevention
{What can be done to prevent recurrence?}
```
