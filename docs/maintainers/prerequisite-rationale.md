# Prerequisite discovered mid-run — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/prerequisite.md`. It is never
read during a run — every table row, command and stop an agent acts on stays in the procedure document,
and a change to this file changes no rule.

## Where each rule came from

- The procedure's body relocated out of the entry read, which keeps the trigger (`SKILL.md` → §2) and
  the pointer (`entry-sequence.md` / `backlogrun-park.md`) — joshuafolkken/kit#2189.
- A prerequisite is a third situation, distinct from an upstream defect and from a split: something
  else in _this_ repository has to land first. The four-row table exists because reading one kind of
  mid-run work as another is the failure the procedure prevents.
