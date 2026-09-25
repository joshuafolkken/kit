# Filing an Issue — `SKILL.md` §2e's procedure

Read this file when an Issue title exists and before the `gh api … issues` call that files it. Every
filing asks whether the work already exists and which epic owns it; one command answers both:

```bash
pnpm josh issue:scout "<title>"                                   # alias: josh isc
pnpm josh issue:scout "<title>" --body "<one-line summary, citing #N where the work follows one>"
pnpm josh issue:scout "<title>" --body-file <complete-draft.md>
```

- **`Duplicates:` is read, not skimmed.** Open each candidate and apply `issue-fold-existing.md`
  before deciding to file. A complete duplicate of an **open** Issue stops with a `confirmation`
  Telegram and "Please run `fullrun #<existing>` to execute this Issue." A compatible addition follows
  that file's fold path; a separate deliverable follows the ordinary filing path. A title match alone
  never authorizes an edit.
- **A candidate marked `(closed)` is a different answer.** The scan covers what closed recently as
  well as what is open, because the work most likely to be filed twice is the work that just finished.
  A closed candidate that covers the same work means **the work is already done** — so there is nothing
  to run. Verify it against the merged code, then take the exit in `issue-comments.md` → "When the work
  turns out to be already merged". A closed candidate that does *not* cover the work is noted in one
  line and the filing carries on.
- **`none` is an answer.** The command reports no candidate rather than the closest miss.
- **`Epic:` front-loads the placement.** Its recommendation is `epic:bundle`'s, which makes
  `add_to_epic` / `create_epic` Tier A and `ask` a stop, in exactly the reading `SKILL.md` → §2a's
  `into <target>` suffix would have given by hand. Where the user typed `into <target>`, that naming wins.
- **`Epic: not asked` is not `Epic: none`.** The epic half decides from the issue numbers the summary
  names, so a title-only call gives it nothing. **Pass `--body` whenever the work follows an existing
  Issue** — one line citing `#N` is enough, and naming the epic itself (`part of epic #<E>`) is
  answered with that epic.
- **It does not replace `epic:bundle`, which still runs after the filing.** This one answers about an
  Issue that does not exist yet, from a title; that one answers about an Issue that does. Both calls
  happen — the scout before the `issues` call, `epic:bundle` after it.
- **Every filing route runs it, not only a `new` entry point, and `pnpm josh rule:guard` refuses a
  filing the run has not scouted** (`prompts/collaboration-workflow/rule-delivery.md`) — the trigger is
  the `gh api … issues` call, never which keyword started the run, so `SKILL.md` → §2d's prerequisite,
  §2i's observation and the review round cap's branch-2 filing all go through it.
- **A `#N` entry point does not run it *for the Issue it was handed*.** `fullrun #N` / `halfrun #N` /
  `kickoff #N` are given an Issue that already exists. That says nothing about an Issue such a run goes
  on to file later, which the bullet above covers.
- **The split path files each child through the same step.** The epic itself is not scouted: it is
  created over children that were, and `epic:bundle` places it afterwards.

Full behavior, the thresholds and why the duplicate half compares titles rather than bodies:
`docs/josh-commands.md` → "`josh issue:scout`".
