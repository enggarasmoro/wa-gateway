---
description: Profile-driven performance optimization — profile → analyse → prioritise → implement one fix at a time
---

# Performance Optimization Workflow

**Trigger:** User provides profiling data, requests performance optimization, or benchmarks show a regression.

Before starting, read the skill and the relevant language module:
- `.claude/skills/perf-optimization/SKILL.md`
- `.claude/skills/perf-optimization/languages/{language}.md`

---

## Steps

### 1. Collect Profile Data

**If the user provides a profile file or URL:**
```bash
# Go — CPU profile
bash .claude/skills/perf-optimization/scripts/go-pprof.sh cpu profile.prof

# Go — generate and analyse in one step
bash .claude/skills/perf-optimization/scripts/go-pprof.sh bench ./path/to/package/... BenchmarkName

# Frontend — Lighthouse
bash .claude/skills/perf-optimization/scripts/frontend-lighthouse.sh
```

**If the user requests profiling from scratch:**
Run the script in `bench` mode to generate and analyse profiles in a single step.

---

### 2. Analyse

Create a structured analysis document at `docs/research_logs/{component}-perf-analysis.md`.

Analysis methodology:
1. Focus on cumulative cost; trace flat back to user-land code
2. Identify the top 3–5 offenders
3. Separate benchmark artifacts from real production cost
4. Identify irreducible floors (refer to the language module's table)

---

### 3. Prioritise Fixes

Create an implementation plan ranked by impact / risk:
- Low risk, high impact → do first
- High risk, any impact → do last or skip

**Present the plan to the user and wait for approval before writing any code.**

---

### 4. Implement (one fix at a time)

For each fix:
1. **Write the test first** (TDD Red → Green)
2. **Implement the fix**
3. **Run all existing tests** (`go test -race ./...` or equivalent)
4. **Benchmark immediately** — compare ns/op, B/op, allocs/op
5. **Run quality checks** (formatter, linter, security scanner)
6. **Commit independently:**
   ```
   perf(<scope>): <description>
   ```

**Rule:** One fix per commit. Never batch optimisations.

---

### 5. Final Verification

After all fixes are applied:
1. Run the full benchmark suite with at least `-count=3`
2. Compare against the original baseline (before any fixes)
3. Run the complete test suite with `-race`
4. Run all quality checks (formatter, linter, security scanner, build)

---

### 6. Document Results

Update the analysis document with:
- Before / after benchmark comparison table
- Which fixes were applied and which were skipped (with reasons)
- Remaining optimisation opportunities for future sessions

---

### 7. Ship

Commit and present final results to the user with:
- Cumulative benchmark improvement table
- List of commits
- Any follow-up items

---

## Quick Reference

| Phase | Output | Gate |
|-------|--------|------|
| Profile | Raw data + extracted markdown | Data collected |
| Analyse | `docs/research_logs/{component}-perf-analysis.md` | Top offenders identified |
| Prioritise | Implementation plan | User approved |
| Implement | Tests + code + benchmark per fix | Each fix passes tests |
| Verify | Full benchmark comparison | All checks pass |
| Ship | Conventional commits | User notified |
