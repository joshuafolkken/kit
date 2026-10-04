# Maintaining kit

For the people who maintain `@joshuafolkken/kit` itself. Projects that use kit can skip everything
reached from this page — the user documentation starts at [overview.md](../overview.md).

## Release and publish

- [release.md](./release.md) — releasing a new version
- [publishing.md](../publishing.md) — the publish jobs and the one-time public npm setup
- [release-classification-audit.md](./release-classification-audit.md) — the audit behind the first
  GitHub Release's change classification

## Measure the distributed rules

- [eval.md](../eval.md) — `josh eval`, measuring whether a document change changed what an agent does
- [eval-rationale.md](./eval-rationale.md) — why the suite is built the way it is
- [guide-verification.md](./guide-verification.md) — how the step-by-step user guides were verified
- [backlogrun-worker-evaluation.md](./backlogrun-worker-evaluation.md) — evaluating the `backlogrun`
  worker profile
- [implementation-step-evaluation.md](./implementation-step-evaluation.md) — the deterministic
  operation sequences found across implementation lanes

## Why the rules and commands are the way they are

The history behind a procedure, kept off every run's read path. Each one is cited section by section
from the page it explains.

- [claude-md-history.md](./claude-md-history.md) — `CLAUDE.md`
- [principles-rationale.md](./principles-rationale.md) — the collaboration principles
- [operating-rules-rationale.md](./operating-rules-rationale.md) — the operating rules
- [residency-rationale.md](./residency-rationale.md) — where a rule is written down
- [rule-delivery-rationale.md](./rule-delivery-rationale.md) — how a rule reaches the agent
- [file-edits-rationale.md](./file-edits-rationale.md) — file edits
- [shell-body-rationale.md](./shell-body-rationale.md) — shell bodies
- [turn-batching-rationale.md](./turn-batching-rationale.md) — turn batching
- [wip-cap-rationale.md](./wip-cap-rationale.md) — the open-Issue cap
- [observation-filing-rationale.md](./observation-filing-rationale.md) — filing observations
- [epic-commands-rationale.md](./epic-commands-rationale.md) — the `josh epic:*` commands
- [backlogrun-steps-rationale.md](./backlogrun-steps-rationale.md),
  [backlogrun-child-rationale.md](./backlogrun-child-rationale.md),
  [backlogrun-lanes-rationale.md](./backlogrun-lanes-rationale.md),
  [backlogrun-progress-rationale.md](./backlogrun-progress-rationale.md) — `backlogrun`
- [pre-gate-cut-rationale.md](./pre-gate-cut-rationale.md) — the pre-gate session cut
- [background-commands-rationale.md](./background-commands-rationale.md) — backgrounding the gate
  and the push
- [latest-gate-rationale.md](./latest-gate-rationale.md) — the dependency-update window
- [split-assessment-rationale.md](./split-assessment-rationale.md) — the split assessment
- [josh-commands-rationale.md](./josh-commands-rationale.md) — the `josh` commands
- [josh-commands-automation-rationale.md](./josh-commands-automation-rationale.md) — the automation
  `josh` commands
- [init-rationale.md](./init-rationale.md) — `josh init`
- [sync-rationale.md](./sync-rationale.md) — `josh sync`
- [environment-variables-rationale.md](./environment-variables-rationale.md) — the notification
  commands

## Directories that are never published

`scripts/cost`, `scripts/time`, `scripts/retrospective` and `scripts/eval` are excluded by
`package.json` `files` because they run only in this repository; a `*-runtime` sibling
(`scripts/cost-runtime`, `scripts/time-runtime`) holds the part the published `josh` commands import,
so a split is a publish boundary, not a topic one.

## The observation ledger

[observations/](./observations/) holds one file per Issue: the review findings and observations a run
recorded. `josh` commands write it.
