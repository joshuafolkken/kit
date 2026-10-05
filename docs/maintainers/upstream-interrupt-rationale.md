# Upstream interrupt — rationale

This is maintainer-only history behind `prompts/collaboration-workflow/upstream-interrupt.md`. It is
never read during a run, and a change to this file changes no rule. The reasons below used to sit
inside the rule text; they moved here in joshuafolkken/kit#3179 so the procedure states each rule once.

## Why there is no blocking test

The procedure has no "does this block the current work?" question, and its trigger is discovery
rather than the moment a defect starts to block.

- A blocking judgement is made under pressure to keep the work moving, so it tips toward "does not
  block" exactly when a workaround is most attractive.
- The line between blocking and non-blocking does not exist yet at discovery. A defect that looked
  harmless often bites first at the completion gate, after the work has already bent around it.
  Removing the judgement makes the rule fire before a stopgap enters the tree.
- Filing without asking is Tier A because filing is the action the rule already prescribes; a
  confirmation adds nothing.
- Some redundancy is an accepted cost. Stopping on a discovery the user would have waved through costs
  one round trip; waving through one that should have stopped lands a workaround in a repository
  distributed to every consumer. A rule applied every time beats a judgement that occasionally misses.
- Inside `backlogrun` only the reach of the stop narrows, to the one child. Filing and the workaround
  ban are unchanged, and those two are what keep a workaround out of the tree.

The `## Origin` backlink matters because the upstream Issue carries the defect while the originating
Issue carries the evidence; without the link the upstream Issue cannot be read later.

## Why third-party writes are Tier C

Filing without asking rests on the tracker being ours: a duplicate costs one backlog line, and a
filing, a stash and an Issue comment are all reversible and cheap. None of that holds for a repository
we do not own.

- A third-party Issue is published under the user's GitHub account, notifies watchers and is indexed
  by search. Closing it later undoes none of that, and it spends maintainer time nobody offered.
- The first-party flow gains no new friction from this split.
- The `third-party-write` row in `scripts/rules/delivered-rules.ts` uses the same computation as
  `pnpm josh repo:party` to refuse a third-party `gh api` write; reads pass.

## Why a correct diagnosis is not authorization

In sveltejs/kit#16623 the finding itself was correct and verifiable against the upstream source, yet
publishing it without explicit instruction was still the wrong procedure. The correctness of a finding
exempts nothing in the third-party section.
