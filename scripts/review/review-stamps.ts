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

const review_stamps = {
	GATE_PREFIX,
	gate_stamp,
	IN_FLIGHT_PREFIX,
	in_flight_stamp,
	ROUND_ONE_PREFIX,
	round_one_stamp,
}

export { review_stamps }
