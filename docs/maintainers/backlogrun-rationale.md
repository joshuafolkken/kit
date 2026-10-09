# `backlogrun` manifest — rationale

This is the maintainer-only rationale behind `.claude/skills/workflow-commands/backlogrun.md`: the
reasons and history behind the manifest's shape. It is never read during a run — the manifest carries
the ordered flow, the route table and the guards, and points here only for why they are what they are.
A change to this file changes no rule.

## Why the loop's position is computed

`pnpm josh run:step <N>` reads the run's position from the event stream, the carry record and the issue
state rather than from the conversation, so a session cut, a compaction or a fresh resume reaches the
same next step from the same three inputs (joshuafolkken/kit#2248). A position carried only in the
conversation is lost at exactly the moments a long run is most likely to hit.

## Where each rule came from

The manifest states these rules without their issue numbers; the provenance is kept here.

- The manifest is a manifest, not the procedure: terse triggers plus a route table naming the one
  section each moment reads — joshuafolkken/kit#2190
- The loop's current position is computed by `run:step`, not carried in the conversation —
  joshuafolkken/kit#2248
- A named item may be a single issue or an epic; this folded in the old `epicrun` keyword —
  joshuafolkken/kit#1985
