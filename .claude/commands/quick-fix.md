---
description: Fast bug fixes and hotfixes — skip research, minimal verify
---

# Quick-Fix Workflow

## When to Use
- Bug fixes with a known root cause
- Small, isolated changes (< 50 lines)
- Production hotfixes
- Addressing findings from `/audit`

## Do Not Use For
- New features → use `/orchestrator`
- Large restructuring → use `/refactor`
- Changes touching multiple features or modules

## Pre-Implementation Checklist
Before starting, you MUST:
1. Read `.claude/rules/rule-priority.md`
2. Confirm the fix scope is truly small and isolated

---

## Phase 1: Diagnose

1. Identify the bug or issue
2. Locate the affected code
3. If the root cause is not obvious → use `/debug` for systematic analysis
4. Define the fix in `task.md` (1–3 items maximum)

---

## Phase 2: Fix + Test (TDD)

1. **Write a failing test** that reproduces the bug
2. **Apply the minimal fix** to make the test pass
3. **Verify all existing tests** still pass

Applicable rules:
- `.claude/rules/error-handling-principles.md`
- `.claude/rules/logging-and-observability-mandate.md`

---

## Phase 3: Verify + Ship

1. Run the full validation suite:
   ```bash
   # Go:         go vet ./... && go test ./...
   # TypeScript: tsc --noEmit && vitest run
   # Python:     mypy . && pytest
   ```
2. If all checks pass → commit:
   ```
   fix(<scope>): <short description>
   ```

---

## Completion Criteria
- [ ] Bug reproduced with a test
- [ ] Fix applied and test passes
- [ ] Full verification suite passes
- [ ] Committed with type `fix`
