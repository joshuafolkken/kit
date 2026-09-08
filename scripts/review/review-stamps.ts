import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_map_stamp, type FileMapStampAccess } from '#scripts/josh/file-map-stamp'

// The three records `josh review:brief` reads (joshuafolkken/kit#1241, joshuafolkken/kit#1242).
//
// **The gate stamp** is written by `josh gate` when all four checks pass, and answers "were lint, the
// type check, the spell check and the unit tests green on *this exact tree*". Without the tree half
// the brief would assert a result that a later edit had already invalidated, which is the one kind of
// report this repository refuses to make.
//
// **The in-flight marker** exists only while `josh gate` is running, and answers a question the gate
// stamp cannot: the review and the gate now start together, so at the moment the brief is composed
// the checks have usually not finished (joshuafolkken/kit#1242). Without it that state is
// indistinguishable from "no gate was ever run", and the review agent re-runs the unit suite the run
// is already running — the exact cost joshuafolkken/kit#1241 removed. **It asserts nothing about the
// result**, only that a gate was started on this tree and the run joins it before committing.
//
// **The marker names its writer by pid *and* start time** (joshuafolkken/kit#1245). A pid on its own
// is not a process: an interrupted gate leaves its marker behind, and once the operating system
// reissues that pid the liveness probe passes again and the marker resumes asserting a gate that
// ended. The pair closes that, because a reissued pid necessarily started after the record was
// written. **The marker was not made weaker to fix it** — dropping it, or having the brief ignore it,
// would put the re-run joshuafolkken/kit#1242 removed straight back.
//
// **A marker whose gate is gone is left where it is, and that is the decision rather than an
// oversight** (joshuafolkken/kit#1245's second question). Three things make leaving it correct here.
// The record is keyed per checkout, so exactly one file exists and nothing accumulates; the next
// `josh gate` overwrites it, since `write_stamp` unlinks before it creates; and the identity check
// makes a leftover inert for as long as it sits there. Removing it from the reader would buy none of
// that and would cost the one thing that matters: the reader deletes on "not running", which is also
// the answer a platform that cannot report a start time gives for a gate that **is** running — so the
// sweep would delete live markers there, and the next brief of that same run would lose the in-flight
// sentence. `unit-worker-share.ts` sweeps and is not inconsistent with this: its markers are keyed per
// pid, so they accumulate without bound, and that is what a sweep is for.
//
// **The round-1 snapshot** is written by the brief itself, so that `--round 2` can name the fix
// delta by comparison rather than by an agent recalling which files it edited.
//
// Both key on `PROJECT_ROOT` rather than the package directory: a globally installed `josh` has one
// package directory for every project on the machine, so keying on it would let a run in one project
// answer for another (the distinction joshuafolkken/kit#1215 drew for `josh latest:scope`).
//
// **`PROJECT_ROOT` is `process.cwd()`, so the two commands must run from the same directory to share
// a record.** That is deliberate rather than overlooked: run from different directories they simply
// miss each other, the brief finds no record, and it prints `Not verified` — the safe direction. The
// tree *inside* the record cannot be left to `cwd()` the same way, because there a mismatch resolves
// to "every file absent" on both sides and compares equal, so `review-tree.ts` asks git for the
// repository root instead.

const GATE_PREFIX = 'josh-gate-stamp-'
const IN_FLIGHT_PREFIX = 'josh-gate-running-'
const ROUND_ONE_PREFIX = 'josh-review-round1-'

const gate_stamp: FileMapStampAccess = file_map_stamp.create(GATE_PREFIX, PROJECT_ROOT)
const in_flight_stamp: FileMapStampAccess = file_map_stamp.create(IN_FLIGHT_PREFIX, PROJECT_ROOT)
const round_one_stamp: FileMapStampAccess = file_map_stamp.create(ROUND_ONE_PREFIX, PROJECT_ROOT)

// **The round-1 snapshot's lifetime is one run, and something has to end it**
// (joshuafolkken/kit#1441). Since the record is written once and never retaken, one left on disk
// would be the record the **next** run's fix delta is measured against — so the run that ends removes
// it, and `josh followup` is where a run ends. That is the answer to "the same run or a new one" the
// retake guard needs, taken from the event itself rather than from a proxy for it.
//
// **Only one of the two directions is safe, which is why the caller is a single place.** A record
// this never reaches — a run that stopped before `followup`, a `--no-merge` invocation, a `halfrun`,
// a review run on its own — is measured from further back, so the next run's delta is wider and the
// answer is `required`. **Removing one out of turn is the unsafe direction**: the next round-1 brief
// finds nothing and writes a fresh record against the already-fixed tree, and arm A then fires on
// unreviewed fix code — the defect joshuafolkken/kit#1441 closed, reintroduced from the other side.
// So this is called from the end of a run that **merged**, and from nowhere else.
//
// Swallowed, and the caller is why: by the time this runs the pull request has already merged, so a
// temp-directory problem must not turn a completed run into a failed one.
function clear_round_one(target?: string): void {
	try {
		round_one_stamp.remove(target)
	} catch {
		/* a record left behind widens the next round rather than narrowing it */
	}
}

const review_stamps = {
	clear_round_one,
	GATE_PREFIX,
	gate_stamp,
	IN_FLIGHT_PREFIX,
	in_flight_stamp,
	ROUND_ONE_PREFIX,
	round_one_stamp,
}

export { review_stamps }
