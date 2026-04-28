---
description: Iterative analysis for complex problems — step-by-step reasoning with revision and branching. Usage: /sequential-thinking <problem>
---

# Sequential Thinking

Problem to analyse: **$ARGUMENTS**

## When to Use
- Breaking down complex problems into manageable steps
- Planning and design that requires iterative refinement
- Analysis that might need course correction mid-stream
- Problems where the full scope emerges during analysis
- Multi-step solutions that require context across steps
- Hypothesis generation and verification

---

## Methodology

Sequential thinking follows a dynamic process:

1. **Initial estimate** — start with an estimate of how many thoughts are needed, but stay flexible
2. **Iterative analysis** — work through thoughts sequentially while building context
3. **Revision capability** — question or revise previous thoughts as understanding deepens
4. **Branch exploration** — explore alternative approaches when needed
5. **Hypothesis cycle** — generate hypotheses, verify against the thought chain, repeat
6. **Convergence** — continue until reaching a satisfactory solution

---

## Instructions

### Starting Out
- Estimate the initial number of thoughts based on problem complexity
- Begin with thought 1, establishing context and approach
- Set `totalThoughts` conservatively — you can adjust as the problem's scope becomes clearer

### During Analysis
- Build on previous thoughts while maintaining context
- Filter out irrelevant information at each step
- Express uncertainty when present
- Revise freely if you spot errors or find a better approach

### Revision Pattern
When reconsidering a previous thought:
```
Thought [N/Total]: On reflection, thought 3's assumption about X was incorrect because Y...
[Revises thought 3]
```

### Branching Pattern
When exploring an alternative:
```
Thought [N/Total]: Branching from thought X to explore an alternative approach...
[branchFromThought: X]
```

### Hypothesis Cycle
1. Generate a hypothesis based on current understanding
2. Verify it against the previous thought chain
3. If verification fails → revise or branch
4. Repeat until the hypothesis is validated

### Completion
- Only conclude when you are genuinely satisfied with the solution
- Provide a single, clear final answer
- Ensure the answer directly addresses the original problem

---

## Output Format

```
Thought [N/Total]: {current thinking step}
[If revision: "This revises thought X because..."]
[If branching: "Branching from thought X to explore..."]

[Continue with next thought]

Solution: {clear, direct answer to the original problem}
```

---

## Key Principles

- **Flexibility over rigidity** — adjust your approach as understanding deepens
- **Revision is strength** — correcting course shows good reasoning
- **Hypothesis-driven** — generate and test hypotheses iteratively
- **Context-aware** — maintain awareness of previous thoughts while progressing
- **Clarity at completion** — deliver a single, clear final answer

For concrete examples, see `.claude/skills/sequential-thinking/resources/examples.md`.
