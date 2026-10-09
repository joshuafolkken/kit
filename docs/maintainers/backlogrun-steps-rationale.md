# `backlogrun` steps — the rationale behind the procedure

This document is maintainer-only: it holds the reasons, history and measurements behind the rules in
`.claude/skills/workflow-commands/backlogrun-steps.md`. The procedure document states what a run does;
this one records why it does it that way, so a change to a rule can be weighed against the reason it
was written. It is never read during a run — nothing here is an instruction, and a rule stated only
here binds nobody.

## Why the authorization boundary is shaped this way

**The declaration is the authorization.** `backlogrun` declares "everything opted in", and a named
epic declares "the children of that epic". That declaration is the statement of what may be executed
unattended, and it is the one thing a run must not leave ambiguous — which is why what runs is stated
by the keyword and its arguments, never inferred from the shape of a request.

**A run labelling its own inputs would be widening its own authorization**, which is why `auto-ok`
stays a person's to apply. A named issue is approved by the keyword and its number for the same reason
`queue` was explicit authorization to merge each of its issues (joshuafolkken/kit#1984): typing them is
the declaration.

**Why the prohibited repairs are prohibited** (joshuafolkken/kit#1675). Dropping a run's own filings
from the pool, or demanding a person's `auto-ok` on a child as well, would each restore a bound by
discarding work `epic:bundle` deliberately placed. The earlier "promise" was an authorization boundary
rather than a convenience, so withdrawing it without putting something in its place would have left
"file → run → file again" with no ceiling at all — the self-widening `split-assessment.md` refuses
when it forbids a `fullrun` promoting itself to a batch. The old promise bounded the _kind_ of work
that could run; the budget bounds the _amount_, which is the only thing left to bound once a run's own
filings are admitted deliberately. The ten-filings ceiling and `--max` together are why the loop
terminates: after them the run ends and the next one waits for a person to type the keyword.

**Why the end-of-run retrospective may apply `auto-ok`** (joshuafolkken/kit#2328). It is the single path
on which a run labels its own input, and it is not the self-widening the rule guards against because
every brake bounds it with no exception: its filings count against the ten-per-invocation ceiling, the
WIP cap, `--max`, the session budget and the 8-hour whole-run bound exactly as any other filing does.
A retrospective that judges nothing worth carrying files nothing, so "file → drain → file again"
converges the moment improvements run out.

**Why two filing routes are exempt from the depth test.** A `route:tier-a` or `route:interrupt`
filing is one the run cannot proceed without, so it cites its own blockage by construction. A review
branch-2 filing has already cleared a bar the discretionary route has not — a confirmed defect
reaching a runtime path, with a written failure scenario — and gating it on a citation as well would
drop the one kind of finding both documents agree is never dropped.

## Why a session cut does not end the run

**Typing `backlogrun` once authorizes the declared budget, and a session cut is an execution detail of
spending it** (joshuafolkken/kit#1714). This is not an exception to the explicit-invocation rule: what
that rule forbids is _inferring_ a workflow from the shape of a request; it never required the
keystroke to land in every session's transcript. A resumed session is a machine continuing an
authorization a person gave, exactly as a delegated child runs `fullrun` in a unit where nobody typed
the keyword. Because the boundary is the budget, the budget has to survive the cut — and the
conversation is the one place it cannot live, hence the carry record.

**Why `--owner "$PPID"` matters.** It names the parent loop's own long-lived process, which is what
lets `run:carry` answer `busy` instead of letting a second parent count into a budget still being
spent. Without it every standing record reads as not provably live — refused rather than resumed, so
nothing is lost silently, but the useful half of the answer is gone. When the sandbox cannot read a
process-start token a live PID is conservatively held as `busy`: stopping on a reused PID costs a
decision, while replacing a genuinely live owner creates two parents on one budget. A count must name
the owner so that a session whose record a successor took over cannot advance a budget that is no
longer its own.

**Why the stopping answers stop.** `busy` stops because counting into the record would put two parents
on one budget. `mismatch` stops because resuming into it would spend another run's `--max` and its
hours. `unreadable` stops because a budget that cannot be carried is a run that restarts it at the next
cut, which is the whole defect the record exists to fix. A `--resume` without `--owner` leaves the
record with no owner, so `busy` degrades to `standing` for every parent after.

**Why the parent alone writes the record.** The parent is what reads GitHub to verify a child merged,
so it is also what counts that merge — one sequential loop writing one record, never two lanes at
once. Every counter is an increment and the command owns the sum, because a run sending a total would
be sending arithmetic done in its head.

**Why a cut hands off to exactly one successor even while the cutting process lives**
(joshuafolkken/kit#1935, joshuafolkken/kit#2437): otherwise every resume would stall on `busy`. A
count issued after the `--cut` is refused so the hand-off is protected rather than silently spent.

**Why the bounds are fed from the record.** A resumed run that started its budget over would stop 8
hours after the _last_ cut instead of after the invocation, which is no bound at all. The number of
cuts is reported because a run reporting only what it merged would hide that it spanned several
sessions.

**Why `--end` is never batched with the final report** (joshuafolkken/kit#2393): `run:report` scopes by
the record `--end` removes. The `--stopped` confirmation exists so a person learns the run halted even
when the session was cut and the parent is headless (joshuafolkken/kit#2136).

**Why the invocation is recorded in canonical form** (joshuafolkken/kit#1719). What the supervisor
hands the next session is composed from constants and validated integers rather than copied out of
the record, and the woken session hands that text straight back to `run:carry --begin` to be compared
character for character — so a record its own rebuild would rewrite cannot be woken.

**Why the reading is scoped to `backlogrun`.** A `fullrun` declares no budget of the kind this rests
on — it ends at one issue and has nothing to carry — so its cut still waits for a person's keystroke.

## Why the plan and the decision pass come first

The plan is reported before anything starts (joshuafolkken/kit#1652) so a person sees the shape of the
run before it spends anything. It is a separate command rather than a `backlog:next` flag because
`backlog:next`'s standard output is one bare token per line and a plan printed there would break the
loop.

**The decision pass spends a person's attention once, up front**, instead of interrupting an
unattended run over and over. Its issues are read in one call because this pass is where a parent
reads the most issues in a row, and a parent's cost grows as n²/2 in its own request count
(joshuafolkken/kit#1567), so a turn removed here is worth more than a turn removed inside a child. It
never measures because a benchmark or a profile would put the whole backlog behind a research task.
Labelling what it finds moves the cost onto the label, so every later plan classifies by the label
alone rather than re-reading the body.

**Why `needs-decision` is the one label a run may apply by hand.** `auto-ok` and `needs-human-review`
widen or withhold what may be _executed_. `needs-decision` records only that a person's answer is
needed, which is a finding rather than an authorization. `auto-ok` reaching a run's own filing through
`issue:file`'s default (joshuafolkken/kit#3213) is computed from a person's earlier opt-in — the live
carry record or the branch issue's label — so the run inherits an authorization rather than granting one.

## Why the loop's contract is shaped this way

**Why `backlogrun` takes no `owner/repo#N` token** (joshuafolkken/kit#1630). A qualified token was
implemented and withdrawn, because `--exclude` parses bare integers and feeding one back produces a
usage error rather than an exclusion.

**Why `retry` may be re-asked and `error` may not** (joshuafolkken/kit#1663). `retry` says GitHub did
not answer — a statement about the connection, not about the graph — so asking again is the same
question rather than a second opinion. `error` forbids a run answering its own question; picking an
issue by hand after it would be the run choosing its own membership. `retry` has no watcher-delivered
wake because the outage that produced it stops the watcher reading too, and a declined watcher does
not exit. An exit 1 with empty output is not `none`, because reading it as one would report an empty
backlog that was never seen.

**Why the epic label limit is recorded rather than worked around** (joshuafolkken/kit#1633). The epic
side is found server-side by the `epic` label; an epic that never received the label is invisible to
the listing. That is a known limit of the listing, not something a run can repair.

**Why an opted-in epic owns its children** (joshuafolkken/kit#1668): offering a child beside its
opted-in epic would hand the same issue over twice. Cross-epic ordering (joshuafolkken/kit#1943) lets
one `backlogrun` run two epics in order without the person sequencing the commands.

**Why merged issues are fed back through `--exclude`.** GitHub applies `closes #N` asynchronously, so a
just-merged issue can still read as open on the next ask and be offered a second time.

## Why the idle watch defaults to 30 minutes

The budgets were introduced by joshuafolkken/kit#1632 and the watch was turned on by default by
joshuafolkken/kit#1676. **30 minutes** (single source `scripts/backlog/backlog-budget.ts` →
`DEFAULT_IDLE_MINUTES`) is about the length of one child (12–28 minutes), so a run that has emptied its
backlog waits roughly as long as one more issue would have taken. **A watch is polled every 5 minutes
rather than at the loop's 60-second interval** because it is waiting on a person, on human timescales;
the reason `backlog:budget` prints names the interval so the loop reads it rather than remembering it.

**Why `--active` is required whenever the watch is on**: without it an emptiness nobody watched could
be reported as an ordinary `stop`.

## Why the cost check skips a watch

A watch does not count towards the session cut (joshuafolkken/kit#1676), and that is a decision rather
than an omission. The hand-off check is asked at a child's merge, and a watch has no merges. A watch
holds nothing — the working tree's hold and every lane were released at the last child's merge — and
its cost is bounded before it starts (`--idle N` is at most `N / 5` asks). When the watch picks
something up the run has work again, and the check is asked at that child's merge in the ordinary way.
Taking every cut at a merge is also what lets a resumed session state its own `--active`: a woken
session picks the run up seconds after the merge the cut was taken at.

## Where each rule came from

The procedure states these rules without their issue numbers; the provenance is kept here.

- The two repairs that would bound the authorization the other way (dropping a run's own filings,
  requiring a person's `auto-ok` on a child) are prohibited, and the brake bounds it instead —
  joshuafolkken/kit#1675
- Named issues run first, in the order typed, one at a time — joshuafolkken/kit#1984
- `run:carry` answering `over` ends the conversation and the invocation is retyped in a fresh
  session — joshuafolkken/kit#2760
- The decision pass orders and isolates with `blocked-by`, `run:solo` and `run:lane` —
  joshuafolkken/kit#2776
