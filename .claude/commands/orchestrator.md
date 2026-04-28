---
description: Full 5-phase workflow for new features — research → implement → integrate → verify → ship
---

# Build Feature Workflow

**CRITICAL INSTRUCTION**

YOU ARE FORBIDDEN FROM SKIPPING PHASES.
Treat this file as a state machine. You cannot transition to phase $N+1$ until phase $N$ is fully complete and verified.

## Role

You are a Senior Principal Engineer with a mandate for strict protocol adherence.

Before starting any work, you MUST:
1. Read `.claude/rules/rule-priority.md`
2. Identify which rules apply to this task
3. Read the relevant rule files — they are non-negotiable constraints

---

## Workflow Phases

```
Research → Implement → Integrate → [E2E?] → Verify → Ship
```

Every phase must complete before proceeding. Never trade quality gates for velocity.

---

### Phase 1: Research
**Required rules:** `.claude/rules/project-structure.md`, `.claude/rules/architectural-pattern.md`

1. Analyse the request — what is being asked, what is the scope?
2. Review the current codebase for existing patterns and dependencies
3. Search external documentation using WebSearch / WebFetch if needed
4. Create `task.md` defining the scope and acceptance criteria
5. Save findings to `docs/research_logs/{feature}.md`
6. If a significant architecture decision is needed → run `/adr`

**Gate:** `task.md` and research log must exist before proceeding.

---

### Phase 2: Implement
**Required rules:** `.claude/rules/error-handling-principles.md`, `.claude/rules/logging-and-observability-mandate.md`, `.claude/rules/testing-strategy.md`

1. Follow the TDD cycle: **Red → Green → Refactor**
2. Create the test file first (co-located with the implementation):
   - Go: `*_test.go`
   - TypeScript: `*.spec.ts`
3. Write failing test → implement → make test pass → refactor
4. Unit tests must use mocked dependencies

**Gate:** All unit tests must pass before proceeding to Phase 3.

---

### Phase 3: Integrate
**Required rules:** `.claude/rules/testing-strategy.md`, `.claude/rules/resources-and-memory-management-principles.md`

REQUIRED if ANY of the following are true:
- [ ] Storage / repository files were modified or created
- [ ] External API client files were modified or created
- [ ] Database queries or schema were changed
- [ ] Message queue, cache, or I/O adapter code was touched

**MAY SKIP** only if ALL of the above are false — and the reason must be documented.

1. Write integration tests against real infrastructure (Testcontainers if available)
2. Test adapters against a real database or service

**Gate:** Integration tests must pass.

---

### Phase 3.5: E2E Validation (Conditional)
**Required when:**
- UI components were added or modified
- API endpoints were added / modified that interact with the frontend
- Critical user-facing flows were changed

**May skip when:**
- Pure backend / infrastructure changes
- Internal library refactoring
- Test-only changes

Use Playwright or the available E2E tool. At least one critical user journey must be tested.

**Gate:** At least one critical user journey passes.

---

### Phase 4: Verify
**Required rules:** `.claude/rules/code-completion-mandate.md` + all applicable mandates

Run the full validation suite:
```bash
# Go
go vet ./... && golangci-lint run && go test ./... -cover

# TypeScript
tsc --noEmit && eslint . && vitest run --coverage

# Python
mypy . && ruff check . && pytest --cov
```

Checklist before proceeding:
- [ ] Were any storage / database adapter files modified? → Phase 3 REQUIRED
- [ ] Were any UI changes made? → Phase 3.5 REQUIRED
- [ ] Lint passes?
- [ ] All tests pass?
- [ ] Build succeeds?
- [ ] Coverage did not drop?

**Gate:** ALL linters, tests, and builds must pass. If anything fails — fix it first, do not proceed.

---

### Phase 5: Ship
**Required rules:** `.claude/rules/git-workflow-principles.md`

```bash
git status
git diff --staged
git add <specific-files>   # never blindly git add .
git commit -m "feat(<scope>): <description>"
```

Conventional commit types:
- `feat(scope): description` — new feature
- `fix(scope): description` — bug fix
- `refactor(scope): description` — refactoring
- `test(scope): description` — adding tests
- `docs(scope): description` — documentation

Update `task.md`: mark all items as `[x]`.

---

## task.md Status Markers

- `[ ]` = Not started
- `[/]` = In progress (mark when **starting**)
- `[x]` = Complete (mark **only after Phase 4 passes**)

**Rule:** Never mark `[x]` before Phase 4 (Verify) passes.

---

## Error Handling

If a phase fails:
1. **Document the failure** in the task summary
2. **Do not proceed** to the next phase
3. **Fix the issue** within the current phase
4. **Re-run** the phase completion criteria
5. Then proceed

---

## Quick Reference

| Phase | Output | Blocking |
|-------|--------|----------|
| Research | `task.md` + `docs/research_logs/*.md` | Yes |
| Implement | Unit tests + code | Yes |
| Integrate | Integration tests | Yes (for adapters) |
| E2E (conditional) | E2E tests | Yes (when required) |
| Verify | All checks pass | Yes |
| Ship | Git commit | Yes |
