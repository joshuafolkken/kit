# Target repository prefix — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/target-repository.md`: the
reasons and history behind the `owner/repo#` prefix. It is never read during a run — every rule and
refusal an agent acts on stays in the procedure document, and a change to this file changes no rule.

## Why the prefix reads as it does

**Read at the point of use** (joshuafolkken/kit#2161). A run given a bare `#N` or `new` never reaches
the prefix, so it costs a workflow entry nothing to leave the definition out of the entry read.

**One slot, no new keyword.** The prefix goes where `#N` goes, so every entry point accepts it without a
new keyword being added.

**A short name never searches the checkout map** (joshuafolkken/kit#869). The map answers where a
checkout is rather than which repository is meant, so expanding a short name by owner alone is what
makes a third-party resolution structurally impossible.

**It is not the bare `#N` prohibition.** What that prohibition forbids is a bare _Issue number_, which
resolves without complaint to a different issue of the same number; a bare _repository_ name whose
owner is determined has no such failure mode.

**A third-party stop records nothing.** The run stops before anything has been produced, so there is no
finding to record and no draft to prepare.

**Never clone, never stash.** Cloning decides the layout of someone's machine for them, and a dirty tree
holds work that is not the run's to stash — which is why a missing checkout or an unclean tree stops the
run rather than being repaired.
