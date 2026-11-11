# `kickoff` — Planning phase only (plan → Issue → Telegram notify → stop)

- `kickoff #<N>`: **First `pnpm josh run:entry <N> --to kickoff`** (`docs/how-to/run-issues.md`) — it claims
  nothing and prints the stage line alone; on `start: reached` report the stage line and **stop**. Then:
  1. Read Issue #N **and every comment on it** — `pnpm josh issue:read <N>`; the later text is the
     agreement in force (`issue-comments.md`, which also carries the answers that stop the run).
  2. Derive a clear English title.
  3. Analyze requirements → **scope assessment per `split-assessment.md` → "The question"**, exactly
     as `kickoff new` does.
  4. **Record the plan** — written to a file in the session language (`JOSH_SESSION_LANG`, default
     `ja`), then `pnpm josh issue:plan <N> --body-file .josh/tmp/plan.md --title "<title>" --planned`, which
     records it, applies `run:planned` and sends the `planning` Telegram (`docs/josh-commands-backlog.md`
     → "`josh issue:plan`"). A target named in front of the reference adds `--repo <owner/name>`.
     Before writing the plan, run `pnpm josh plan:consumers <identifier...>` on what it adds or changes
     and finish the `### 影響を受ける既存の利用者` draft it prints.
  5. Report the plan, the Telegram's last line `Next: halfrun #<N> | prrun #<N> | fullrun #<N>`, then **stop** (do not implement).

  **Two or more separately-mergeable deliverables** take the split path instead of a plan: create the
  children as in `kickoff new`, then either **promote `#N`** with `pnpm josh epic --promote <N> <N1> <N2>
  ... --title "<title>" --notify [--ordered] [--rationale-file .josh/tmp/rationale.md]` (when `#N` is a request, a discussion
  or a container) — `--title` renames it to the step-2 title — or keep `#N` as a child of a new epic
  made with `pnpm josh epic … --notify`, renamed when its own plan is recorded (`issue:plan --title`). That branch is Tier A: choose and
  record the reasoning on the Issue. Present `pnpm josh backlogrun <E> --only` and stop.

  `--notify` sends the split path's `planning` Telegram — the epic's URL, every child's URL and the
  `backlogrun` line (`docs/josh-commands-backlog.md` → "`josh epic`").

**`kickoff` does not claim the working-tree hold, and does not release one** — it touches GitHub, never
the tree (`working-tree-hold.md`).

**The target repository is named in front of the Issue reference** — `kickoff kit#new`,
`kickoff joshuafolkken/kit#<N>` (`target-repository.md`). `kickoff` needs no checkout: name the target with
`--repo <owner/repo>` on every `josh issue:read` and `issue:file` call, and never clone. The exception is the split path's epic — `pnpm josh
epic` writes only the repository it runs in, and the promote arm stops when that repository is not
checked out here. A third-party owner is Tier C: stop rather than file.

- `kickoff new` or `kickoff new "<title>"`: (0) **Scope assessment** per `split-assessment.md` — one
  deliverable takes the **single-issue path**, several the **multi-issue split path**.
  - **Single-issue path**: (1) Derive an English title, or use the one given. (2) `pnpm josh issue:file
    "<title>" --body-file .josh/tmp/body.md --over-cap` plus the labels the words typed after `new` name
    ("Words typed after `new`", below; body per `prompts/collaboration-workflow/issue-template.md`) —
    its duplicate scan runs first, and a candidate covering the same work stops the run (`SKILL.md` →
    `issue-scout.md`). Capture `<N>`. (3) Post the plan as `kickoff #<N>` does — its `--planned` sends the Telegram. (4)
    **Stop**.
  - **Multi-issue split path**: (1) Per deliverable, `pnpm josh issue:file "<sub-title>" --body-file
    .josh/tmp/body.md --route split` plus the labels the words after `new` name (duplicate scan
    per `issue-scout.md`). A split filed into another repository gives every child body the `## Origin`
    backlink, the epic the same link as prose (never a checkbox row, which disables its auto-close), and
    the originating Issue lists children and epic under `## Upstream issues`. (2) **Epic — always, for
    every split into two or more Issues**: `pnpm josh epic "<epic-title>" <N1> <N2> ... --notify [--ordered]
    [--rationale-file .josh/tmp/rationale.md] [--origin <owner/repo#N>]`, capturing `<E>`; check a hand-edited epic
    with `pnpm josh epic:check <E>`. (3) `--notify` sends the Telegram listing every created Issue.
    (4) Present `pnpm josh backlogrun <E> --only`. (5) **Stop**.

  **The epic itself is never implemented** — `backlogrun` runs its *children*, and it closes itself
  once every child is closed, whichever josh path closes the last one. Children with no required order take `None — the children are
  independent; any execution order works.` under `Dependencies`. **Only when the execution order
  matters** (`execution-waves.md` → "When a wave may be declared") pass `--ordered`, which treats the
  argument order as the dependency order.

  Without `josh`: `issue-template.md` → "複数 Issue に分割するときの epic Issue".

`pnpm josh issue:file` lints the body and applies the classification labels it declares (`issue-template.md`; `docs/josh-commands-backlog.md` → `josh issue:file`).
An Issue a consumer can use only once it is published is filed with `--release` (`kickoff new`), or linked with `pnpm josh issue:release <N>` (`kickoff #N`) — either makes it a blocker of the repository's `release` Issue, which never gets `auto-ok` on its own.

## Words typed after `new`

**`auto-ok` is judged by `pnpm josh issue:file`, never typed** — the excluded labels and the body's
`- 人の判断:` declaration; a `不要` declaration also needs a run label (`issue-template.md`).
`auto ok` typed after `new` adds nothing.

**Words after `new`** (`kickoff new high`) are read like `into <target>`, never inferred. Each adds its
labels to the filing; a word not in the table is asked about:

| Typed      | Added to `pnpm josh issue:file` |
| ---------- | ------------------------------- |
| `auto ok` | nothing — `issue:file` judges it |
| `critical` | `--label priority:critical`     |
| `high`     | `--label priority:high`         |

A typed priority wins: `issue:file` then skips the body's `- 優先度:` judgement (`scripts/issue/issue-priority.ts`).
