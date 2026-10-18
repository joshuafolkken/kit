# `kickoff` — Planning phase only (plan → Issue → Telegram notify → stop)

- `kickoff #<N>`: **First `pnpm josh run:entry <N> --to kickoff`** (`docs/how-to/run-issues.md`) — it claims
  nothing and prints the stage line alone; on `start: reached` report the stage line and **stop**. Then:
  1. Read Issue #N **and every comment on it** — `pnpm josh issue:read <N>`; the later text is the
     agreement in force (`issue-comments.md`, which also carries the answers that stop the run).
  2. Derive a clear English title.
  3. Analyze requirements → **scope assessment per `split-assessment.md`**.
  4. **Record the plan** — written to a file in the session language (`JOSH_SESSION_LANG`, default
     `ja`), then `pnpm josh issue:plan <N> --body-file <path> --title "<title>" --planned`: it renames
     the issue, fills a blank body or comments otherwise, and applies `run:planned`, so the next
     command's `run:entry` starts at the implementation. A target named in front of the reference
     adds `--repo <owner/name>`.
  5. Send the Telegram notification, its last line `Next: halfrun #<N> | prrun #<N> | fullrun #<N>` →
     **stop** (do not implement).

  **Two or more separately-mergeable deliverables** take the split path instead of a plan: rename `#N`
  to the step-2 title (`gh api -X PATCH repos/{owner}/{repo}/issues/<N> -f title="<title>"` — neither
  `issue:plan` nor `epic --promote` runs here to apply it), create the children as in `kickoff new`,
  then either **promote `#N`** with `pnpm josh epic --promote <N> <N1> <N2>
  ... [--ordered] [--rationale-file <path|->]` (when `#N` is a request, a discussion or a container), or
  keep `#N` as a child and create a new epic with `pnpm josh epic`. That branch is Tier A: choose and
  record the reasoning on the Issue. Present `backlogrun #<E> --only` and stop.

  Telegram: `pnpm josh notify --task-type planning --issue-url "<issue-url>" --body=$'-
  <bullet1>\n- <bullet2>\n...'`. `--task-type` sets the icon (`planning` 📋 / `completion` ✅ /
  `failure` ❌ / `kickoff_retry` 🔄 / `confirmation` ⏸️); `--repo-name` and `--issue-title` are
  auto-fetched. The Issue URL must be included.

**`kickoff` does not claim the working-tree hold, and does not release one** — it touches GitHub, never
the tree (`working-tree-hold.md`).

**The target repository is named in front of the Issue reference** — `kickoff kit#new`,
`kickoff joshuafolkken/kit#<N>` (`target-repository.md`). `kickoff` needs no checkout: name the target in
every `gh api` path, reads included, and never clone. The exception is the split path's epic — `pnpm josh
epic` writes only the repository it runs in, and the promote arm stops when that repository is not
checked out here. A third-party owner is Tier C: stop rather than file.

**Read `split-assessment.md` → "The question" first** — `kickoff #N` assesses scope exactly as
`kickoff new` does. The default is not to split: separability and a scope clearly over one verification
gate must hold **together**. The rest of `split-assessment.md` is read when a split is found.

- `kickoff new` or `kickoff new "<title>"`: (0) **Scope assessment** per `split-assessment.md` — one
  deliverable takes the **single-issue path**, several the **multi-issue split path**.
  - **Single-issue path**: (1) Derive an English title, or use the one given. (2) `pnpm josh issue:file
    "<title>" --body-file <body-file>` plus the labels the words typed after `new` name
    ("Words typed after `new`", below; body per `prompts/collaboration-workflow/issue-template.md`) —
    its duplicate scan runs first, and a candidate covering the same work stops the run (`SKILL.md` →
    `issue-scout.md`). Capture `<N>`. (3) Post the plan as `kickoff #<N>` does. (4) Telegram. (5)
    **Stop**.
  - **Multi-issue split path**: (1) Per deliverable, `pnpm josh issue:file "<sub-title>" --body-file
    <body-file> --route split` plus the labels the words after `new` name (duplicate scan
    per `issue-scout.md`). A split filed into another repository gives every child body the `## Origin`
    backlink, the epic the same link as prose (never a checkbox row, which disables its auto-close), and
    the originating Issue lists children and epic under `## Upstream issues`. (2) **Epic — always, for
    every split into two or more Issues**: `pnpm josh epic "<epic-title>" <N1> <N2> ... [--ordered]
    [--rationale-file <path|->] [--origin <owner/repo#N>]`, capturing `<E>`. It builds the `epic` label,
    the task-list rows (`- [ ] #N`), the machine-readable `Dependencies` and the `backlogrun` line; check
    a hand-edited epic with `pnpm josh epic:check <E>`. (3) Telegram listing every created Issue. (4)
    Present `backlogrun #<E> --only`. (5) **Stop**.

  **The epic itself is never implemented** — `backlogrun` runs its *children*, and `pnpm josh followup`
  closes it once every child is closed. Children with no required order take `None — the children are
  independent; any execution order works.` under `Dependencies`. **Only when the execution order
  matters** (`execution-waves.md` → "When a wave may be declared") pass `--ordered`, which treats the
  argument order as the dependency order.

  **Only where `josh` is unavailable**, the manual fallback: `gh api repos/{owner}/{repo}/labels -f
  name=epic -f color=5319e7 -f description="Tracks a batch of child issues from one split" --silent
  2>/dev/null || true`, then `gh api repos/{owner}/{repo}/issues -f title="<epic-title>" -f
  'labels[]=epic' -F body=@<body-file>` with the epic format of `issue-template.md`; an order is
  recorded per pair with `gh api repos/{owner}/{repo}/issues/<N2>/dependencies/blocked_by -F
  issue_id="$(gh api repos/{owner}/{repo}/issues/<N1> --jq .id)"` (the blocker's **database id**; a
  failure is non-fatal), never folded into the creation call.

`pnpm josh issue:file` lints the body and applies the classification labels it declares (`issue-template.md`; `docs/josh-commands-backlog.md` → `josh issue:file`).
An Issue a consumer can use only once it is published is filed with `--release` (`kickoff new`), or linked with `pnpm josh issue:release <N>` (`kickoff #N`) — either makes it a blocker of the repository's `release` Issue, which never gets `auto-ok` on its own.

## Words typed after `new`

**`auto-ok` is judged by `pnpm josh issue:file`, never typed** — the excluded labels and the body's
`- 人の判断:` declaration; a `不要` declaration also needs a run label (`issue-template.md`).
`auto ok` typed after `new` adds nothing.

**Words after `new`** (`kickoff new high`) are read like `into <target>`, never inferred. Each adds its
labels to the filing; a word not in the table is asked about:

| Typed     | Added to `pnpm josh issue:file` |
| --------- | ------------------------------- |
| `auto ok` | nothing — `issue:file` judges it |
| `high`    | `--label priority:high`         |
