// The run marks' keys alone (joshuafolkken/kit#7309), apart from `run-headless.ts`, whose imports would
// pull the carry and lane registry into the unit config's import graph that blanks them.

const HEADLESS_ENV_KEY = 'JOSH_RUN_HEADLESS'
// A session `josh run:handoff` started. It runs under its launcher's process, so the launcher's carry
// owner is its ancestor too; the mark keeps it from reading as the `backlogrun` parent the way a lane
// child's own mark does (`driving_carry`).
const HANDOFF_CHILD_KEY = 'JOSH_HANDOFF_CHILD'
// A triage session `run:wake` started beside its driver (joshuafolkken/kit#7120). It runs under the
// supervisor that owns the record, so without the mark its turn-end would cut the record the
// still-running driver holds.
const BESIDE_CHILD_KEY = 'JOSH_BESIDE_CHILD'

const MARK_KEYS: ReadonlyArray<string> = [HEADLESS_ENV_KEY, HANDOFF_CHILD_KEY, BESIDE_CHILD_KEY]

const run_headless_keys = {
	BESIDE_CHILD_KEY,
	HANDOFF_CHILD_KEY,
	HEADLESS_ENV_KEY,
	MARK_KEYS,
}

export { run_headless_keys }
