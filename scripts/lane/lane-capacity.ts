import type { LaneEnvironment } from './lane-paths'

// How many lanes one repository may run at once, and how many of them are free
// (joshuafolkken/kit#1491).
//
// **Nothing here knows what a lane holds.** The limit is a number, the occupancy is a number, and
// the answer is a number — so the same pool serves an epic's children, several epics' children at
// once, or anything else a scheduler decides to put in a lane. Threading an epic through this module
// is what would have to be undone the first time two epics run together, and the whole reason
// joshuafolkken/kit#1491 built the scheduler epic-free from the start.
//
// **It is a ceiling, not a prediction.** Six lanes does not say six children will run at once; it
// says a seventh will not start. What actually runs is bounded by what is runnable, by the port
// seats `lane-seed.ts` can allocate, and by the machine.

// Six rather than the nine seats `lane_seed_policy` can allocate: the seats are the hard structural
// bound, this is the one a person tunes, and leaving headroom between them means raising the limit
// never lands on "the ports ran out" as its first symptom.
const DEFAULT_LANE_LIMIT = 6
const LANE_LIMIT_KEY = 'JOSH_LANE_LIMIT'
const POSITIVE_INTEGER = /^[1-9]\d*$/u
const NO_LANES = 0

// The limit, or why it could not be read. A problem rather than a throw, for the reason
// `eval-runner.ts` records for `JOSH_EVAL_CONCURRENCY`: the caller decides whether a bad setting
// ends the command or is reported and worked around, and only it knows which.
type LimitChoice = { kind: 'limit'; limit: number } | { kind: 'problem'; problem: string }

// **An invalid value is a hard error, never a silent fall back to the default** — the rule
// `PORT_SEED` already holds to. A typo that quietly becomes 6 is a limit nobody set, and the whole
// point of the setting is that the number is the one a person chose.
//
// Blank is unset, not invalid: an `.env` line left as `JOSH_LANE_LIMIT=` is a variable nobody
// configured, exactly as `lane_paths.lane_root` reads a blank root.
function read_limit(raw: string | undefined): LimitChoice {
	const trimmed = raw?.trim() ?? ''

	if (trimmed === '') return { kind: 'limit', limit: DEFAULT_LANE_LIMIT }

	if (!POSITIVE_INTEGER.test(trimmed)) {
		return {
			kind: 'problem',
			problem: `${LANE_LIMIT_KEY} must be a positive integer, not "${trimmed}"`,
		}
	}

	return { kind: 'limit', limit: Number(trimmed) }
}

function lane_limit(environment: LaneEnvironment = process.env): LimitChoice {
	return read_limit(environment[LANE_LIMIT_KEY])
}

// Never negative: a repository holding more `in-progress` issues than the limit allows — the limit
// was lowered, or a stale label outlived its run — has no free lane, and a negative count read as
// "how many to offer" would be a slice nobody meant.
function free_lanes(limit: number, occupied: number): number {
	return Math.max(NO_LANES, limit - occupied)
}

const lane_capacity = {
	DEFAULT_LANE_LIMIT,
	LANE_LIMIT_KEY,
	read_limit,
	lane_limit,
	free_lanes,
}

export type { LimitChoice }
export { lane_capacity }
