# The `owner/repo#` prefix — which repository the run acts on

**This file is the prefix's single source, read at its point of use — the moment an entry is typed with an
`owner/repo#` prefix (or a short `repo#` name), not at any entry.** A run given a bare `#N` or `new`
targets the session's own repository and never reaches it. `SKILL.md` → §2's table keeps the trigger and
points here. Rationale: `docs/maintainers/target-repository-rationale.md` → "Why the prefix reads as it does".

Every entry point takes the target repository in front of the Issue reference. Without it the target
is the repository the session runs in.

```
kickoff joshuafolkken/kit#<N>
kickoff kit#new
kickoff kit#new "<title>"
fullrun joshuafolkken/app-kit#<N>
halfrun kit#<N>
backlogrun kit#<N> kit#<M>
backlogrun joshuafolkken/kit#<N> --only
```

- **One definition, every entry point.** The prefix goes where `#N` goes, and `owner/repo#new` stands
  in the same slot as `owner/repo#N`.
- **A short name expands by prefixing the session repository's owner** — `pnpm josh repo:party`
  computes the party — and **never by searching `pnpm josh doctor`'s checkout map**. A short name
  therefore satisfies the first-party test (owner equality) by construction, so **there is structurally
  no path by which a short name resolves to a third-party target**, and a repository that is not
  checked out here is still a valid `kickoff` target. A name that does not exist fails as `gh` not
  found: report it, never read it as a near-miss for another name.
- **It is not the standing prohibition on a bare `#N`**, which forbids a bare *Issue number*; a bare
  *repository* name whose owner is determined is allowed.
- **An explicit owner that is not the session's is a third-party target, and it stops the run.**
  `fullrun <other-owner>/repo#<N>` names a tracker we do not own, and every write there is Tier C
  (`CLAUDE.md` → "Third-party repositories are Tier C"). **Decide it mechanically** with
  `pnpm josh repo:party <owner/repo>` — a `third-party` verdict stops the run. Typing the prefix is not the
  explicit instruction that rule requires. **Send a `confirmation` Telegram and stop** — there is no
  finding to record and no draft to prepare.
- **No prefix leaves the behavior exactly as it was** — the target is the session's repository.
- **`kickoff` needs no checkout**: name the target repository with `--repo <owner/repo>` on every
  `pnpm josh issue:file` call and in the path of every `gh api` call, and never clone. The one exception
  is the split path's epic, since `pnpm josh epic` only writes the repository it runs in — run it in
  that repository's checkout. With no checkout there, file the children, report that the epic could
  not be created, and stop — a hand-built `gh api …/issues` filing of the epic is refused by the
  `direct-filing` guard, and `pnpm josh issue:file` lints an epic body against the Issue template. The
  promote arm stops the same way.
- **The implementing entries require a checkout and never create one — when the target is another
  repository.** A prefix naming the session's own repository changes nothing (`fullrun kit#<N>` in the
  kit checkout behaves exactly as `fullrun #<N>`). Otherwise resolve the checkout from `pnpm josh
  doctor`'s map; **no checkout there, or a tree that is not clean, stops the run** with a
  `confirmation` Telegram — never clone, never stash. Otherwise the commands that act on the target
  execute in that checkout.
- **A named epic is exempt from the whole bullet above**: `owner/repo#E` names where the *epic* lives,
  not where its children are implemented. Its state is read against that repository through `gh api`,
  so that repository needs no checkout. The checkout rules bind each child at implementation time,
  against **that child's** repository ("Concurrency" in `backlogrun.md`).
- **Independent of `into <target>`**: this says which repository the run acts on, `into` says which
  epic the artifact joins — `kickoff kit#new into joshuafolkken/kit#<E>` is one correct line.
