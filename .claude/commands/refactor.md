---
description: Safe code restructuring while preserving behaviour — requires a specific, scoped goal
---

# Refactor Workflow

## When to Use
- Code restructuring (moving, renaming, splitting modules)
- Pattern migration (e.g. callbacks → async/await)
- Dependency upgrades with breaking changes
- Addressing tech debt or architectural improvements

**Requires a specific goal:**
- ✅ `/refactor extract storage interface from task feature so it can be mocked in tests`
- ✅ `/refactor split authentication logic out of handlers/user.go into its own handler`
- ❌ `/refactor apps/backend` — too vague, run `/audit` first to identify specific issues

## Do Not Use For
- New features → use `/orchestrator`
- Small bug fixes → use `/quick-fix`
- "Find what to improve" → run `/audit` first, then `/refactor` for structural findings

## Pre-Implementation Checklist
Before starting, you MUST:
1. Read `.claude/rules/rule-priority.md`
2. Read `.claude/rules/architectural-pattern.md` and `.claude/rules/project-structure.md`

---

## Phase 1: Impact Analysis

1. **Map the blast radius** — which files, modules, and tests are affected?
2. **Document existing behaviour** — which tests currently pass? what contracts exist?
3. **Identify risks** — can this be done incrementally or does it require a big-bang change?
4. **Create a refactoring plan** in `task.md` with incremental steps
5. If the decision involves significant trade-offs → create an ADR with `/adr`

---

## Phase 2: Incremental Change (TDD)

For each step in the refactoring plan:
1. **Ensure existing tests pass** before making any change
2. **Make one incremental change** — move, rename, or restructure
3. **Run tests after each change** — behaviour must be preserved
4. **Add new tests** if the refactoring exposes untested behaviour

Applicable rules:
- `.claude/rules/architectural-pattern.md`
- `.claude/rules/code-organization-principles.md`

**Key principle:** Never break the build for more than one step at a time.

---

## Phase 3: Parity Verification

1. Run the full validation suite
2. **Compare test coverage** — coverage must be equal to or better than before
3. **Verify no behaviour change** — same inputs produce same outputs
4. Run E2E tests if applicable

---

## Phase 4: Ship

Follow `.claude/rules/git-workflow-principles.md` with commit type:
```
refactor(<scope>): <description>
```

---

## Completion Criteria
- [ ] Impact analysis documented
- [ ] All changes made incrementally with tests passing at each step
- [ ] Full verification suite passes
- [ ] Test coverage equal to or better than before
- [ ] Committed with type `refactor`
