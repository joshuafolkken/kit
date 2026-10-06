# josh eval — rationale and history

History behind [eval.md](./eval.md), kept here so the user-facing page states only the rules a run
follows today.

## Why the suite exists

Until [joshuafolkken/kit#855](https://github.com/joshuafolkken/kit/issues/855) there was no way to tell
whether editing the distributed documents changed anything. Every observed violation was answered with
more prose, and prose was the only evidence in either direction — so a rule that never worked looked
exactly like one that did, and nothing was ever deleted. The measurement joshuafolkken/kit#907 added
exists to catch a distributed document degrading while every other check stays green.

## Why it is wired into no gate

Since [joshuafolkken/kit#1922](https://github.com/joshuafolkken/kit/issues/1922) the suite is wired into
no verification or completion gate at all: one run is five real Claude sessions, and on the tree this
shipped from the suite almost never reached `held`, so the wait it added to every distributed-document
change was not worth paying automatically. The scenarios' unreliability is its own Issue; the command
stays exactly so a `blocked` verdict's baseline and confirmation readings — and any diagnosis of the
scenarios themselves — remain possible.

## Why the scenarios run side by side

They used to run one at a time with a 20-second pause between them, on the stated grounds that "the
scenarios share one API rate budget" — a cause
[#1001](https://github.com/joshuafolkken/kit/issues/1001) went looking for and did not find: what it
measured instead was `API Error: Unable to connect to API (ConnectionRefused)`, which is a connection
failure rather than throttling ([#1144](https://github.com/joshuafolkken/kit/issues/1144)).

## Why `unreachable` is its own verdict

`unreachable` and `unmeasured` both leave the rules unmeasured and neither blocks a merge, so the fourth
word buys nothing at the merge and everything at the report: a reader sent to the `?` lines to fix the
harness or the prompt found nothing wrong with either, because the fault was a refused connection
(joshuafolkken/kit#1197). Under its own word the suite says which one to look at, and a run of them
three days running is visible as three of the same word.

**At the shipped default the two-refusal stop saves less than it looks like.** Five scenarios and a
width of five means every scenario is dequeued before the first verdict returns, so no scenario is ever
queued and the only sessions left to skip are retries — and a refused session is not retried in the
first place. So on the run this was written for, where every session meets the same refusal, the tally
skips nothing at all: the five sessions were already in flight, and none of them would have made a
second attempt. What it does save is the mixed run — refusals accumulating while other scenarios come
back merely inconclusive — where it stops up to three of those retries, and any suite wider than its
pool, where everything still queued is skipped. Lower `JOSH_EVAL_CONCURRENCY` and the queue, and the
saving, appear at five scenarios too.

## Why a `blocked` verdict is confirmed before it blocks

One scenario is one real Claude session, so its verdict is a sample rather than a fact: measured on
[joshuafolkken/kit#1071](https://github.com/joshuafolkken/kit/issues/1071), `no-implicit-workflow`
failed 2 of 10 readings of an **unchanged** tree. Reading each side once therefore manufactures
`held → failed` about one time in six on its own, which is what stopped the merge on
joshuafolkken/kit#1062.

**That is a trade, and not a uniformly favorable one.** A rule that stopped working outright fails
both readings and is a real regression; one that only _sometimes_ fires can pass the second reading
and slip through — at 7 failures in 10 readings it gets through about 3 times in 10, which is larger
than the one-in-six false alarm being removed. What it buys is a check that is reliable rather than
one that is strictly stronger, and the reason is about behavior rather than probability: a check that
fails at random is one people learn to argue with, and the next real failure is then
attributed away with the reasoning the false ones taught. Filing the disagreement against the
scenario is what keeps it honest — a rule failing half its readings surfaces as a ruler nobody can
read rather than as silence.

## Why an unmeasured run is never green

"Measured and held" and "could not measure" must not both read as "nothing was wrong": the suite exists
to catch a distributed document degrading while every other check stays green, and an unmeasured run is
exactly that not happening (joshuafolkken/kit#1001). The stream's own failing `result` event was the
only source of a reason in every case observed across joshuafolkken/kit#908.

## How the connection failures were found

**Pacing came first.** Running sessions back to back was the first suspected cause of an empty
transcript — across joshuafolkken/kit#908 the suite degraded run over run at a 20-second spacing (4/5
scenarios held, then 2/5, then no verdict at all, then 1/5) while every one of those same scenarios held
when run on its own moments later — so a 20-second pause went between scenarios and a 60-second one
before the single retry.

**That explanation did not hold up.** The first run to print a reason named something else entirely —
`API Error: Unable to connect to API (ConnectionRefused)`, on every inconclusive scenario, after the
session had started (joshuafolkken/kit#1001). Raising the spacing to 45 seconds and adding a second
retry at 180 recovered nothing while nearly doubling the worst-case suite time. The inter-scenario
pause was therefore removed and the retry wait cut from 60 seconds to 5: a wait that was never shown to
prevent anything, and under a pool it holds a slot for the whole time (joshuafolkken/kit#1144).

**The cause was found, and it was neither pacing nor width.** A session spawned from inside a Claude
session inherited the parent's own `CLAUDE_CODE_MESSAGING_SOCKET` — a UNIX socket only the parent
listens on — dialled it, and was refused; lowering `JOSH_EVAL_CONCURRENCY`, the suspected cause, made
it worse. Removing that variable and the three beside it from the child's environment restored 5/5 held
in 54 seconds (joshuafolkken/kit#1158, carried into joshuafolkken/kit#1197).

**The loopback proxy** (joshuafolkken/kit#1760). Whatever wraps this machine's package manager may stand
a scanning proxy up on a loopback port and write `HTTPS_PROXY` into everything the invocation spawns —
and a session that inherits it dials that port instead of the API. `josh run:wake` is where it was
found, because a detached supervisor outlives the invocation and the port is gone by the time it wakes
anything; the eval suite spawns its sessions while that proxy is still listening, so it was never the
one failing. It is removed from eval sessions all the same: neither launcher starts a package install,
and a proxy that exists to inspect package downloads has no business carrying a session's API traffic.

**That fix did not retire the defense built beside it.** A connection can fail again for reasons that
have nothing to do with an inherited socket, and the failure mode being closed is the one where the
suite pays for five sessions and returns `unmeasured` — so a refused connection is reported under its
own verdict and stops the suite starting further sessions, whatever caused it.

**What was observed while building the suite.** Each scenario passed when run on its own, while a full
run returned complete transcripts for the first two and empty ones for the rest — and after several
full runs in one sitting, even the first scenario stopped starting. That was read as a shared upstream
budget being exhausted, which nobody had measured; what the first reason to be printed actually named
was `ConnectionRefused` (joshuafolkken/kit#1001). One thing that _was_ measured, on
joshuafolkken/kit#1144: the symptom tracks how many Claude sessions that machine is running at once,
not how closely one run's scenarios follow each other. Two eval runners left running as orphans were
enough to make the next scenario fail with `ConnectionRefused` twice in a row; the same scenario held
once they were stopped, and a five-wide run of the whole suite held 5/5.

## Why a partly-run session is not thrown out

While the suite was being built, an unclosed stdin pipe made the CLI stall for three seconds and every
transcript came back empty — and three prohibition scenarios reported green while measuring nothing.
That is why a session that made no tool calls, or died before a required call, is inconclusive rather
than a pass.
