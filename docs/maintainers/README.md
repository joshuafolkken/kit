# Maintaining kit

For the people who maintain `@joshuafolkken/kit` itself. Projects that use kit can skip everything
reached from this page — the user documentation starts at [overview.md](../overview.md).

## Language

Every page here is written in English, one language per document. A rationale explaining a
Japanese-language prompt file (`prompts/collaboration-workflow/*.md`, `.claude/skills/**`) quotes that
file's headings and rule text verbatim, in double quotes or a code span, so the pointer still
resolves; the explanation around the quote is English, and `maintainers-documents.test.ts` fails a
page with Japanese anywhere else. A one-off audit or evaluation is not kept here once it has done its
job — its conclusion lands in the rule or rationale it informed. The
user documentation (`docs/`, `docs/how-to/`, `docs/setup/`) follows the same rule, keeping Japanese
only where it names a literal a command matches (an issue-body heading such as `## 背景`, a prompt
heading a pointer cites).

The reference pages state each command's behavior, options, exit codes and examples; why a behavior
is the way it is, and the issues it came from, live in the matching `*-rationale.md` here.

## Release and publish

- [release.md](./release.md) — releasing a new version
- [publishing.md](../publishing.md) — the publish jobs and the one-time public npm setup

## Measure the distributed rules

- [eval.md](../eval.md) — `josh eval`, measuring whether a document change changed what an agent does
- [eval-rationale.md](./eval-rationale.md) — why the suite is built the way it is
- [guide-verification.md](./guide-verification.md) — how the step-by-step user guides were verified

## Why the rules and commands are the way they are

The history behind a procedure, kept off every run's read path. Each one is cited section by section
from the page it explains.

- [claude-md-history.md](./claude-md-history.md) — `CLAUDE.md`
- [overview-rationale.md](./overview-rationale.md) — the workflow overview and session language
- [principles-rationale.md](./principles-rationale.md) — the collaboration principles
- [operating-rules-rationale.md](./operating-rules-rationale.md) — the operating rules
- [upstream-interrupt-rationale.md](./upstream-interrupt-rationale.md) — the upstream interrupt
- [issue-citation-rationale.md](./issue-citation-rationale.md) — citing Issues in session output
- [gh-rest-rationale.md](./gh-rest-rationale.md) — `gh` in REST
- [residency-rationale.md](./residency-rationale.md) — where a rule is written down
- [rule-delivery-rationale.md](./rule-delivery-rationale.md) — how a rule reaches the agent
- [file-edits-rationale.md](./file-edits-rationale.md) — file edits
- [shell-body-rationale.md](./shell-body-rationale.md) — shell bodies
- [turn-batching-rationale.md](./turn-batching-rationale.md) — turn batching
- [output-bounds-rationale.md](./output-bounds-rationale.md) — the Bash output cap and piped checks
- [wip-cap-rationale.md](./wip-cap-rationale.md) — the open-Issue cap
- [observation-filing-rationale.md](./observation-filing-rationale.md) — filing observations
- [observation-ledger-rationale.md](./observation-ledger-rationale.md) — the observation ledger
- [epic-commands-rationale.md](./epic-commands-rationale.md) — the `josh epic:*` commands
- [backlogrun-steps-rationale.md](./backlogrun-steps-rationale.md),
  [backlogrun-child-rationale.md](./backlogrun-child-rationale.md),
  [backlogrun-lanes-rationale.md](./backlogrun-lanes-rationale.md),
  [backlogrun-progress-rationale.md](./backlogrun-progress-rationale.md),
  [backlogrun-recovery-rationale.md](./backlogrun-recovery-rationale.md) — `backlogrun`
- [progress-watcher-rationale.md](./progress-watcher-rationale.md) — the progress watcher every
  implementing run starts
- [pre-gate-cut-rationale.md](./pre-gate-cut-rationale.md) — the pre-gate session cut
- [background-commands-rationale.md](./background-commands-rationale.md) — backgrounding the gate
  and the push
- [latest-gate-rationale.md](./latest-gate-rationale.md) — the dependency-update window
- [split-assessment-rationale.md](./split-assessment-rationale.md) — the split assessment
- [review-history.md](./review-history.md) — the review policy and rubric
- [testing-guide-history.md](./testing-guide-history.md) — closing the E2E gate
- [josh-commands-rationale.md](./josh-commands-rationale.md) — the `josh` commands
- [josh-commands-automation-rationale.md](./josh-commands-automation-rationale.md) — the automation
  `josh` commands
- [josh-commands-run-rationale.md](./josh-commands-run-rationale.md) — the run, lane and session
  `josh` commands
- [josh-commands-backlog-rationale.md](./josh-commands-backlog-rationale.md) — the issue, epic,
  backlog and review `josh` commands
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
