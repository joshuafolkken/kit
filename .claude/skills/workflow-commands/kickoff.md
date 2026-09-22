# `kickoff` — Planning phase only (plan → Issue → Telegram notify → stop)

- `kickoff #<N>`: Read existing Issue #N **and every comment on it** — `pnpm josh issue:read <N>`; a
  decision recorded after the body was written lives only in a comment, and the later text is the
  agreement in force (`SKILL.md` → §2g, which also carries the two answers that stop the run instead) →
  **normalize the title**: if the title is not in English or can be phrased more clearly, derive a
  better English title and run `gh api -X PATCH repos/{owner}/{repo}/issues/<N> -f title="<title>"` →
  analyze requirements → **scope assessment per `split-assessment.md`** → post the plan to the Issue (if
  body is blank, `gh api -X PATCH repos/{owner}/{repo}/issues/<N> -f body="<plan>"`; otherwise
  `pnpm josh issue:comment <N> --body-file <path>`) → send Telegram notification → **stop**
  (do not implement). **When the assessment finds two or more separately-mergeable deliverables**, take
  the split path instead of posting a plan: create the children as in `kickoff new`, then either
  **promote `#N`** with `pnpm josh epic --promote <N> <N1> <N2> ... [--ordered] [--rationale-file
  <path|->]` — the right choice when `#N` is a request, a discussion or a container — or, when `#N` is
  itself one of the deliverables, keep `#N` as a child and create a new epic with `pnpm josh epic`. That
  branch is Tier A: choose it and record the reasoning on the Issue without asking. Present `backlogrun #<E> --only` and stop. Plan comments are written in the session language (`JOSH_SESSION_LANG`, default `ja`).
  Telegram notification: `pnpm josh notify --task-type planning --issue-url "<issue-url>" --body=$'-
  <bullet1>\n- <bullet2>\n...'`. `--task-type` controls the header icon (`planning` 📋 / `completion` ✅
  / `failure` ❌ / `kickoff_retry` 🔄 / `confirmation` ⏸️). `--repo-name` and `--issue-title` are
  auto-fetched from `gh` when not supplied. The Issue URL must be included.

**`kickoff` does not claim the working-tree hold, and does not release one.** What that guard protects
is one branch, one index and one uncommitted diff; this command reads the Issue, normalizes the title,
posts the plan, notifies and stops — every one of those against GitHub, none against the tree. So a
`fullrun` running in this checkout never stops a `kickoff`, and a `kickoff` never touches the record
that run is holding. It claims nothing, so it must not release anything either. `SKILL.md` → §2f is the
single source.

**The target repository is named in front of the Issue reference** — `kickoff kit#new`,
`kickoff joshuafolkken/kit#412`. The definition is `SKILL.md` → §2c, whose body is `target-repository.md`. `kickoff` is the entry that needs
no checkout: name the target repository in the path of every `gh api` call — reads included — and never
clone. The one exception is the split path's epic, since `pnpm josh epic` writes only the repository it
runs in — and the promote arm has no remote fallback at all, so it stops when that repository is not
checked out here. A target whose owner is not this session's is third-party: Tier C, so it stops rather
than filing.

**Read `split-assessment.md` → "The question" first.** It is the split decision every entry point
applies, including this one — `kickoff #N` assesses scope exactly as `kickoff new` does. Its default is
not to split: separability and a scope that clearly exceeds what one verification gate can confirm in
one pass (the guide is about 10 changed files and about 400 changed lines) have to hold **together**.
The rest of `split-assessment.md` — what each entry does with the answer — is read on demand when a
split is found.

- `kickoff new` or `kickoff new "<title>"`: No Issue exists yet. Steps: (0) **Scope assessment** per
  `split-assessment.md`. If multiple → the **multi-issue split path**; if single → the **single-issue
  path**. **Single-issue path**: (1) Derive an English title from the conversation, or use the provided
  title. **(1a) Run `pnpm josh issue:scout "<title>" [--body "<summary>"]` before creating the Issue** —
  a candidate that covers the same work stops the run rather than filing a second Issue (`SKILL.md` →
  §2e). (2) Create Issue: `gh api repos/{owner}/{repo}/issues -f title="<title>" -f 'labels[]=depth:<n>'
  -f body="<body>"` (body per `prompts/collaboration-workflow/issue-template.md`). Capture `<N>`. (3)
  Post the plan in the session language, using the same body/comment logic as `kickoff #<N>`. (4) Send
  Telegram notification. (5) **Stop** — do not implement. **Multi-issue split path**: (1) For each
  independent deliverable, derive a focused English title, **run `pnpm josh issue:scout "<sub-title>"`
  on it** (`SKILL.md` → §2e), and create a separate Issue with the `route:split` label: `gh api
  repos/{owner}/{repo}/issues -f title="<sub-title>" -f 'labels[]=route:split' -f 'labels[]=depth:<n>'
  -f body="<body>"`. Capture each Issue number. **When the split is filed into a repository other than
  the one this session is running in**, every child body gets the `## Origin` backlink described in the
  cross-package rule the AI documents keep resident, the epic body carries the same link as prose or a
  plain bullet (never as a checkbox row, which would disable its auto-close), and the originating Issue
  lists the children and the epic under `## Upstream issues`. (2) **Epic — always, for every split into
  two or more Issues.** There is no count or ordering condition. **Create it with `pnpm josh epic
  "<epic-title>" <N1> <N2> ... [--ordered] [--rationale-file <path|->] [--origin <owner/repo#N>]`**,
  capturing its number `<E>` from the printed URL. The command satisfies the epic's four mechanical
  requirements by construction — the `epic` label, the task-list rows (`- [ ] #N`), the machine-readable
  `Dependencies`, and the printed `backlogrun` line. Check an epic you wrote or edited by hand with `pnpm
  josh epic:check <E>`. Only where `josh` is unavailable, fall back to the manual procedure: ensure the
  label exists (`gh api repos/{owner}/{repo}/labels -f name=epic -f color=5319e7 -f description="Tracks
  a batch of child issues from one split" --silent 2>/dev/null || true`), then create the epic with `gh
  api repos/{owner}/{repo}/issues -f title="<epic-title>" -f 'labels[]=epic' -f body="<body>"`. Its body
  follows the epic format in `prompts/collaboration-workflow/issue-template.md` — split rationale,
  dependencies, the `backlogrun` command, and a child task list in task-list syntax (`- [ ] #N`). The epic
  exists as the **non-closing home for the split rationale**. When the children have no required order,
  write `None — the children are independent; any execution order works.` under `Dependencies`. **The
  epic itself is never implemented** — a `backlogrun` takes a named epic and runs its *children*. `pnpm josh
  followup` closes it automatically once every child is closed. **Only when the execution order
  matters**, record it natively: `pnpm josh epic --ordered` treats the argument order as the dependency
  order; on the manual fallback path, after the child Issues exist, `gh api
  repos/{owner}/{repo}/issues/<N2>/dependencies/blocked_by -F issue_id="$(gh api
  repos/{owner}/{repo}/issues/<N1> --jq .id)"` for each dependent pair (the endpoint takes the blocker's
  **database id**, not its issue number; a failure here is non-fatal). Never fold the relation into the
  creation call. (3) Send Telegram notification listing all created issues. (4) Present the command
  `backlogrun #<E> --only`. (5) **Stop** — do not implement.
