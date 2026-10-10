# Working-tree hold — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/working-tree-hold.md`: why
the hold is keyed to the working tree and where its resumes came from. It is never read during a run —
every command, answer and stop an agent acts on stays in the procedure document, and a change to this
file changes no rule.

## Where each rule came from

- The hold's body relocated out of the entry read, which keeps the trigger (`SKILL.md` → §2) and the
  pointer (`entry-sequence.md`) — joshuafolkken/kit#2189.
- The halfrun resume — `fullrun #<N>` or `prrun #<N>` adopting a marked `halfrun` stop instead of being
  refused `busy` by it — joshuafolkken/kit#2796 and joshuafolkken/kit#3042.
- The prrun resume and its three `resume: prrun-*` tokens — joshuafolkken/kit#3023.

## Why the unit is the working tree

`epic-busy.ts` is not reused for the hold. That read answers about a _repository_ and implements
`backlogrun`'s one-child-per-repository rule; what the entry points contend for is the branch, the
index and the uncommitted diff of one work tree, which a linked work tree does not share. The two layers guard different
resources, so `backlogrun`'s own guard stays as it is.

`kickoff`'s exemption is a fact about the command rather than a judgement made at the entry: it reads
the Issue, normalizes the title, posts the plan, notifies and stops — every one of those against
GitHub, none against the branch, the index or the diff. So a `fullrun` running in the checkout never
stops a `kickoff`, and a `kickoff` never touches the record that run is holding; since it claims
nothing, it releases nothing either. The exemption changes nothing for `fullrun` or `halfrun`.
