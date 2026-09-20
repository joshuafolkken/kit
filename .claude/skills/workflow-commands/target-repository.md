# The `owner/repo#` prefix — which repository the run acts on

**This is `SKILL.md` → §2c's body, read at its point of use — the moment an entry is typed with an
`owner/repo#` prefix (or a short `repo#` name), not at any entry** (joshuafolkken/kit#2161). A run
given a bare `#N` or `new` targets the session's own repository and never reaches it, so it costs a
workflow entry nothing to leave it here. `SKILL.md` → §2c keeps the trigger and points here.

Every entry point takes the target repository in front of the Issue reference. Without it the target
is the repository the session runs in.

```
kickoff joshuafolkken/kit#412
kickoff kit#new
kickoff kit#new "<title>"
fullrun joshuafolkken/app-kit#12
halfrun kit#412
backlogrun kit#1 kit#2
backlogrun joshuafolkken/kit#858 --only
```

- **One definition, every entry point.** The prefix goes where `#N` goes, so no new keyword is added,
  and `owner/repo#new` stands in the same slot as `owner/repo#N`.
- **A short name expands by prefixing the session repository's owner** — `pnpm josh repo:party`
  computes the party — and **never by searching kit#869's map**, which answers where a checkout is
  rather than which repository is meant. A short name therefore satisfies the first-party test (owner
  equality) by construction, so **there is structurally no path by which a short name resolves to a
  third-party target**, and a repository that is not checked out here is still a valid `kickoff`
  target. A name that does not exist fails as `gh` not found: report it, never read it as a near-miss
  for another name.
- **It is not the standing prohibition on a bare `#N`.** What that forbids is a bare *Issue number*,
  which resolves without complaint to a different issue of the same number; a bare *repository* name
  whose owner is determined has no such failure mode.
- **An explicit owner that is not the session's is a third-party target, and it stops the run.**
  `fullrun <other-owner>/repo#12` names a tracker we do not own, and every write there is Tier C
  (`CLAUDE.md` → "Third-party repositories are Tier C"). **Decide it mechanically** with
  `pnpm josh repo:party <owner/repo>` — a `third-party` verdict stops the run. Typing the prefix is not the
  explicit instruction that rule requires. **Send a `confirmation` Telegram and stop** — nothing has
  been produced yet, so there is no finding to record and no draft to prepare.
- **No prefix leaves the behavior exactly as it was** — the target is the session's repository.
- **`kickoff` needs no checkout**: name the target repository in the path of every `gh api` call and
  never clone. The one exception is the split path's epic, since `pnpm josh epic` only writes the
  repository it runs in — run it in that repository's checkout, or fall back to `gh api
  repos/<owner/repo>/labels …` followed by `gh api repos/<owner/repo>/issues -f title="<epic-title>" -f
  'labels[]=epic' -f body="<body>"`, and report that `epic:check` could not be run. The promote arm has
  no such fallback: with no checkout there, file the children and stop.
- **The implementing entries require a checkout and never create one — when the target is another
  repository.** A prefix naming the session's own repository changes nothing (`fullrun kit#412` in the
  kit checkout behaves exactly as `fullrun #412`). Otherwise resolve the checkout from `pnpm josh
  doctor`'s map; **no checkout there, or a tree that is not clean, stops the run** with a
  `confirmation` Telegram — cloning decides the layout of someone's machine for them, and a dirty tree
  holds work that is not yours to stash. Otherwise the commands that act on the target execute in that
  checkout.
- **A named epic is exempt from the whole bullet above**: `owner/repo#E` names where the *epic* lives,
  not where its children are implemented. Its state is read against that repository through `gh api`,
  so that repository needs no checkout. The checkout rules bind each child at implementation time,
  against **that child's** repository ("Concurrency" in `backlogrun.md`).
- **Independent of `into <target>`**: this says which repository the run acts on, `into` says which
  epic the artifact joins — `kickoff kit#new into joshuafolkken/kit#909` is one correct line.
