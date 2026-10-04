# Latest gate — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/latest-gate.md`. It is never
read during a run — every trigger, command and answer an agent acts on stays in the procedure document,
and a change to this file changes no rule.

## Why an elapsed-time window rather than once per batch

The batch entry points had already hoisted the update to the head of a batch, and that hoist is
correct — but it says nothing about a standalone `fullrun`, which **is** the head of its own
one-issue batch and therefore updated on every invocation. A session that runs six issues one at a
time paid the full cost six times while a batch of the same six paid it once, for no difference
anybody chose. An elapsed-time window is the one condition that reads the same at every entry point,
so no entry needs a rule of its own — and the batch hoists survive it unchanged, because a batch's
second child asks the same command and is told `skip`.

The window removes the other runs carrying the same bumps; it does not make the one diff that ran the
update clean. A CI failure on a bump in that issue is a dependency problem found once, which is why the
procedure fixes it forward rather than parking the issue for it.
