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

## Where each rule came from

Until joshuafolkken/kit#1215 every entry point put `josh latest` at the head of every run and called it
mandatory — so a standalone `fullrun` paid 60–120 seconds for it before touching the issue, and a batch
that ran ten children paid it ten times unless the entry's own file happened to hoist it by hand.
joshuafolkken/kit#1215 made `pnpm josh latest:scope` the trigger and this procedure its single source;
`fullrun.md`, `halfrun.md` and `backlogrun.md` each name the command at the point their procedure
reaches it and route to the procedure for everything else.

The trigger is a command rather than a judgement because "the dependencies are probably still fresh"
is decided under time pressure, and time pressure resolves it toward `skip` exactly when a stale
dependency is most likely to matter — the same reason `pnpm josh review:brief --level-only` took the
review level out of an agent's hands. The per-checkout record is what the old "once per session, not
once per run" wording was reaching for.

The stash pop is by message because the stash is a repository-wide stack every work tree shares, so a
positional pop would take whichever lane last pushed rather than the one this step saved —
joshuafolkken/kit#2050.

`pnpm josh ms` stays unconditional because it brings the previous merge into the tree; an issue that
skips it starts implementing on a stale default branch. The stash before it is the branch switch's: a
dirty tree stops `git switch` whatever `latest:scope` answered.

A `skip` loses the local `pnpm audit` reading, but nothing reaches the default branch without a fresh
audit: the CI `Security Audit` job is a required check. The local reading was a head start on a failure
CI would catch anyway, never the only net.
