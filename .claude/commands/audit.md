---
description: Structured code quality review — identify issues without writing new features. Usage: /audit <path-or-feature>
---

# Audit Workflow

Audit target: **$ARGUMENTS**

## When to Use
- After another agent commits a feature (cross-agent review)
- Periodic quality gates on the codebase
- Before releases or deployments
- When you want assurance without writing new code

## Do Not Use For
- Writing new features → `/orchestrator`
- Fixing known bugs → `/quick-fix`
- Restructuring code → `/refactor`

## Pre-Audit Checklist
Before starting, you MUST:
1. Read `.claude/rules/rule-priority.md` — these form the review criteria
2. Identify the audit scope (specific feature, module, or full codebase)

---

## Phase 1: Code Review

Review against the following categories in priority order:

### 1. Security
- Input validation at all boundaries
- No hardcoded secrets or credentials
- Parameterized queries (no SQL injection)
- Proper authentication / authorisation checks

### 2. Reliability
- Error handling on all I/O operations (no empty catch blocks)
- All resources cleaned up (connections, files, locks)
- Timeouts on external calls
- Graceful degradation patterns

### 3. Testability
- I/O operations behind interfaces / abstractions
- Business logic is pure (no side effects)
- Dependencies injected, not hardcoded
- Test coverage on critical paths

### 4. Observability
- All operation entry points logged (start / success / failure)
- Structured logging with correlation IDs
- Appropriate log levels

### 5. Code Quality
- Follows existing codebase patterns (>80% consistency)
- Functions are focused and small (10–50 lines)
- Clear naming that reveals intent
- No code duplication (DRY)

---

## Phase 1.5: Cross-Boundary Review

Cross-boundary issues live at the seams between components. Activate only the dimensions that apply — and **explicitly state** which ones you are skipping and why.

### Dimension Selection

| Dimension | Activate When |
|-----------|---------------|
| **A. Integration Contracts** | Project has both a frontend and a backend |
| **B. Database & Schema** | Project uses a relational / document database |
| **C. Configuration & Environment** | Always — universal |
| **D. Dependency Health** | Always — universal |
| **E. Test Coverage Gaps** | Always — universal |
| **F. Mobile ↔ Backend** | Project has a mobile app and a backend |

At the start of this phase you MUST state:
> "Activating dimensions: A, B, C, D, E. Skipping F (no mobile app)."

---

**Dimension A: Integration Contracts** *(frontend + backend)*
- [ ] Map every backend endpoint against its frontend adapter — flag any unmapped endpoints
- [ ] Verify request / response field names, types, and status codes match across the boundary
- [ ] Verify all outbound HTTP calls use the project's centralised API client
- [ ] Build an auth coverage matrix: which endpoints require auth, do frontend adapters send tokens?
- [ ] Check error contract alignment: does the frontend handle the full set of error codes the backend can return?

**Dimension B: Database & Schema** *(projects with a database)*
- [ ] Verify all tables have required base columns (`id`, `created_at`, `updated_at`)
- [ ] Check all foreign keys have corresponding indexes
- [ ] Cross-reference struct / model field names against actual DB column names — flag drift
- [ ] Check migrations are reversible (up + down) and follow the additive-first strategy
- [ ] Scan storage adapters for N+1 query patterns

**Dimension C: Configuration & Environment** *(always active)*
- [ ] No hardcoded secrets, tokens, URLs, or credentials in source code
- [ ] `.env.template` exists and covers every env var referenced in the codebase
- [ ] Startup validation fails fast on missing required config
- [ ] Secrets are never logged

**Dimension D: Dependency Health** *(always active)*
- [ ] No unused top-level dependencies
- [ ] No circular dependencies between feature modules
- [ ] Cross-module imports only use each module's public API
- [ ] Run `npm audit` / `go list -m -json all | nancy` / `cargo audit` — flag high-severity CVEs

**Dimension E: Test Coverage Gaps** *(always active)*
- [ ] A handler / controller test exists for every API endpoint
- [ ] An integration test exists for every storage / database adapter
- [ ] Every error path has at least one test that exercises it
- [ ] E2E tests cover the primary user journeys

**Dimension F: Mobile ↔ Backend** *(projects with a mobile app)*
- [ ] API version compatibility — mobile must not call endpoints that no longer exist
- [ ] Offline data sync: conflict resolution and retry logic are tested
- [ ] Auth token refresh flows work when the access token expires mid-session

---

## Phase 2: Automated Verification

Run the full validation suite:
```bash
# Go:         go vet ./... && golangci-lint run && go test ./... -cover
# TypeScript: tsc --noEmit && eslint . && vitest run --coverage
# Python:     mypy . && ruff check . && pytest --cov
```

---

## Phase 3: Findings Report

**Save to:** `docs/audits/review-findings-{feature}-{YYYY-MM-DD}-{HHmm}.md`

> **Zero-Findings Guard:** If the audit produces fewer than 3 findings, you MUST complete the "Dimensions Covered" section before declaring a clean result.

```markdown
# Code Audit: {Feature / Module Name}
Date: {date}

## Summary
- **Files reviewed:** N
- **Issues found:** N (X critical, Y major, Z minor)
- **Test coverage:** N%
- **Dimensions activated:** A, B, C, D, E (list which were skipped and why)

## Critical Issues
Issues that must be fixed before deployment.
- [ ] {description} — {file}:{line}

## Major Issues
Issues that should be fixed in the near term.
- [ ] {description} — {file}:{line}

## Minor Issues
Style, naming, or minor improvements.
- [ ] {description} — {file}:{line}

## Verification Results
- Lint: PASS/FAIL
- Tests: PASS/FAIL (N passed, N failed)
- Build: PASS/FAIL
- Coverage: N%

## Dimensions Covered
| Dimension | Status | Files / Queries Examined |
|-----------|--------|--------------------------|
| A. Integration Contracts | ✅ Checked / ⏭ Skipped (reason) | ... |
| B. Database & Schema     | ✅ Checked / ⏭ Skipped (reason) | ... |
| C. Configuration & Env   | ✅ Checked | ... |
| D. Dependency Health     | ✅ Checked | ... |
| E. Test Coverage Gaps    | ✅ Checked | ... |
| F. Mobile ↔ Backend      | ⏭ Skipped | No mobile app |
```

---

## Feedback Loop

| Finding Type | Example | Workflow |
|---|---|---|
| **Nit / minor** (naming, formatting) | "Rename `x` to `userCount`" | Fix inline |
| **Small isolated fix** (missing log, validation) | "Add input validation on handler" | `/quick-fix` in a new conversation |
| **Structural change** (wrong abstraction, missing interface) | "Storage not behind an interface" | `/refactor` in a new conversation |
| **Missing capability** (new endpoint, auth check) | "No auth middleware on admin routes" | `/orchestrator` in a new conversation |

---

## Completion Criteria
- [ ] All specified files / features reviewed
- [ ] Full verification suite run
- [ ] Findings document saved to `docs/audits/` in the repo
