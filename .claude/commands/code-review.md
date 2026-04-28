---
description: Structured code review against the full rule set. Usage: /code-review <file-or-feature>
---

# Code Review

Review target: **$ARGUMENTS**

## When to Use
- During the `/audit` workflow (Phase 1: Code Review)
- When a standalone code review is requested
- **Best practice:** Invoke in a fresh conversation (not the one that authored the code) to avoid confirmation bias

---

## Review Process

### 1. Define the Scope

Identify the files / feature to review:
- **Feature review** — all files in a feature directory
- **PR review** — only changed files
- **Full codebase audit** — all features

### 2. Load the Rule Set

Read the applicable rules from `.claude/rules/`. Use `.claude/rules/rule-priority.md` for severity classification.

For the language(s) under review, load the anti-pattern checklist:
- Go → `.claude/skills/code-review/languages/go.md`

### 3. Review Categories (Priority Order)

#### Critical (Must Fix)
- **Security** `[SEC]` — injection, hardcoded secrets, broken auth
- **Data loss** `[DATA]` — missing error handling on writes, no transaction boundaries
- **Resource leaks** `[RES]` — unclosed connections, missing cleanup

#### Major (Should Fix)
- **Testability** `[TEST]` — I/O not behind interfaces, untested error paths
- **Observability** `[OBS]` — missing logging on operations, no correlation IDs
- **Error handling** `[ERR]` — empty catch blocks, swallowed errors
- **Architecture** `[ARCH]` — circular dependencies, wrong layer access

#### Minor (Nice to Fix)
- **Pattern consistency** `[PAT]` — deviation from established codebase patterns
- **Naming** — unclear variable / function names
- **Code organisation** — functions too long, mixed responsibilities

#### Nit (Optional)
- **Style** — formatting issues the linter would catch
- **Documentation** — missing comments on complex logic

---

### 4. Produce Findings

Output findings in a structured format:

```markdown
# Code Review: {Feature / Module Name}
Date: {date}
Reviewer: AI Agent (fresh context)

## Summary
- **Files reviewed:** N
- **Issues found:** N (X critical, Y major, Z minor, W nit)

## Critical Issues
- [ ] **[SEC]** {description} — {file}:{line}
- [ ] **[DATA]** {description} — {file}:{line}

## Major Issues
- [ ] **[TEST]** {description} — {file}:{line}
- [ ] **[OBS]** {description} — {file}:{line}

## Minor Issues
- [ ] **[PAT]** {description} — {file}:{line}

## Nit
- [ ] {description} — {file}:{line}

## Rules Applied
List of rules referenced during this review.
```

---

### 5. Save the Report

When invoked via `/audit`, the report **MUST** be saved to the repo:

**Path:** `docs/audits/review-findings-{feature}-{YYYY-MM-DD}-{HHmm}.md`

When invoked standalone, saving is recommended but optional.

---

### 6. Severity Tags

| Tag | Category | Rule source |
|-----|----------|-------------|
| `[SEC]` | Security | `.claude/rules/security-principles.md` |
| `[DATA]` | Data integrity | `.claude/rules/error-handling-principles.md` |
| `[RES]` | Resource leak | `.claude/rules/resources-and-memory-management-principles.md` |
| `[TEST]` | Testability | `.claude/rules/architectural-pattern.md`, `.claude/rules/testing-strategy.md` |
| `[OBS]` | Observability | `.claude/rules/logging-and-observability-mandate.md` |
| `[ERR]` | Error handling | `.claude/rules/error-handling-principles.md` |
| `[ARCH]` | Architecture | `.claude/rules/architectural-pattern.md` |
| `[PAT]` | Pattern consistency | `.claude/rules/code-organization-principles.md` |
| `[INT]` | Integration contract | `.claude/rules/api-design-principles.md` |
| `[DB]` | Database design | `.claude/rules/database-design-principles.md` |
| `[CFG]` | Configuration | `.claude/rules/configuration-management-principles.md` |

---

### 7. Zero-Findings Guard

If this review produces fewer than 3 findings, you MUST produce a "Dimensions Covered" attestation section listing each cross-boundary dimension and the specific files or queries examined before declaring a clean result.
