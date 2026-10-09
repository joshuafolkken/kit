# Finishing a run with `followup` — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/followup.md`: where each
rule came from and the reasons behind the ones whose reason is not self-evident. It is never read
during a run — every rule, table and command an agent acts on stays in the procedure document, and a
change to this file changes no rule.

## Where each rule came from

- `followup.md` becoming the single source, with the former post-execution reference merged into it —
  joshuafolkken/kit#3176.
- A pull request already merged by hand (a `prrun` stop) running only the post-merge tail —
  joshuafolkken/kit#3023.
- The stage-timing block — joshuafolkken/kit#1349; rows named `<a>-and-<b>` for batched requests —
  joshuafolkken/kit#1446.
- A comment listing that could not be read counting as a standing blocker — joshuafolkken/kit#973.
- Reporting the distributed paths a change claims — joshuafolkken/kit#1578; reporting rather than
  stopping — joshuafolkken/kit#1592.
- The release point as a position plus `pnpm josh release:scope`'s answer — joshuafolkken/kit#1582.

In a lane `josh ms` refuses because git allows one branch per work tree; the refresh is the parent's.

## Why config claims are reported, not stopped

In kit every skill or prompt change is a distributed path, so a stop on a claimed path only stopped
the work its own acceptance criteria ordered. The claim is reported in the completion notification
and the Issue report instead, and the merge proceeds.

## The temporary CodeRabbit exemption

CodeRabbit was made non-blocking end to end as a temporary measure — joshuafolkken/kit#753. It is
reverted together with joshuafolkken/kit#752; the revert restores it to the default required checks
and turns its actionable count and unreadable line-comment listing back into blockers.
