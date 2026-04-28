---
description: Create an Architecture Decision Record for significant architectural decisions. Usage: /adr <short-title>
---

# Architecture Decision Record (ADR)

Creating ADR for: **$ARGUMENTS**

## When to Create an ADR
- Choosing between 2+ viable approaches
- Introducing a new dependency or pattern
- Changing existing architecture
- When a decision involves significant trade-offs that should be documented

## Storage Location

ADRs are stored in `docs/decisions/` as numbered files:
```
docs/decisions/
├── 0001-use-postgresql-for-storage.md
├── 0002-adopt-testcontainers.md
└── NNNN-short-title.md
```

Steps:
1. Check the last ADR file in `docs/decisions/` to determine the next number
2. Create `docs/decisions/NNNN-{title-from-arguments}.md`
3. Fill it using the template below

---

## ADR Template

```markdown
# NNNN. {Short Title}

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Deprecated | Superseded by NNNN

## Context
What is the issue that motivated this decision?
Include technical constraints, business requirements, and relevant context.

## Options Considered

### Option A: {name}
- **Pros:** ...
- **Cons:** ...
- **Effort:** Low / Medium / High

### Option B: {name}
- **Pros:** ...
- **Cons:** ...
- **Effort:** Low / Medium / High

### Option C: {name} (if applicable)
- **Pros:** ...
- **Cons:** ...
- **Effort:** Low / Medium / High

## Decision
We chose **Option X** because...

## Consequences

### Positive
- What becomes easier or possible as a result

### Negative
- What becomes harder as a result
- Technical debt introduced (if any)

### Risks
- Identified risks
```

---

## After Creating the ADR

1. Verify the file was saved correctly to `docs/decisions/`
2. Confirm to the user that the ADR has been created and link to the file
3. If within an `/orchestrator` or `/refactor` workflow, continue to the next phase
