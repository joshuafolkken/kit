# Filing an Issue — `SKILL.md` §2e's procedure

Read this file when an Issue title exists and before the `pnpm josh issue:file` call that files it.
Every filing asks whether the work already exists and which epic owns it; the command runs the
`issue:scout` scan on the title and body first and holds the filing until every printed candidate is
named in `--distinct`:

```bash
pnpm josh issue:file "<title>" --body-file <complete-draft.md> --depth <n> [--route <route>]
pnpm josh issue:file "<title>" --body-file <complete-draft.md> --depth <n> --distinct 2801,2795
```

- **`Duplicates:` is read, not skimmed.** Open each candidate and apply `issue-fold-existing.md`
  before deciding to file. A complete duplicate of an **open** Issue stops with a `confirmation`
  Telegram and "Please run `fullrun #<existing>` to execute this Issue." A compatible addition follows
  that file's fold path; a separate deliverable follows the ordinary filing path. A title match alone
  never authorizes an edit.
- **`--distinct` records that each candidate was read.** Reissue the call listing every candidate you
  read and judged separate; never list one you have not read.
- **A candidate marked `(closed)` is a different answer.** The scan covers what closed recently as
  well as what is open, because the work most likely to be filed twice is the work that just finished.
  A closed candidate that covers the same work means **the work is already done** — so there is nothing
  to run. Verify it against the merged code, then take the exit in `issue-comments.md` → "When the work
  turns out to be already merged". A closed candidate that does *not* cover the work is noted in one
  line, named in `--distinct`, and the filing carries on.
- **`none` is an answer.** The command reports no candidate rather than the closest miss.
- **`Epic:` front-loads the placement.** Its recommendation is `epic:bundle`'s, which makes
  `add_to_epic` / `create_epic` Tier A and `ask` a stop, in exactly the reading `SKILL.md` → §2a's
  `into <target>` suffix would have given by hand. Where the user typed `into <target>`, that naming wins.
- **`Epic: not asked` is not `Epic: none`.** The epic half decides from the issue numbers the body
  names. **Cite `#N` in the body whenever the work follows an existing Issue** — one line is enough,
  and naming the epic itself (`part of epic #<E>`) is answered with that epic.
- **`epic:bundle` then runs on the new Issue, in the same call.** Act on its printed answer; a `⚠`
  means rerun `pnpm josh epic:bundle <N>` — the Issue exists, so never refile.
- **Every filing route goes through it** — §2d's prerequisite, §2i's observation and the review round
  cap's branch-2 filing alike; the guard refuses any other filing call
  (`prompts/collaboration-workflow/rule-delivery.md`).
- **A `#N` entry point does not file *the Issue it was handed*.** `fullrun #N` / `halfrun #N` /
  `kickoff #N` are given an Issue that already exists. That says nothing about an Issue such a run goes
  on to file later, which the bullet above covers.
- **The split path files each child through the same command.** The epic is created with
  `pnpm josh epic` over children that were scanned.

Full behavior: `docs/josh-commands.md` → "`josh issue:file`" and "`josh issue:scout`".
