import { cli_flags, type PositiveSetting } from '#scripts/lib/cli-flags'
import { lane_limit_override } from './lane-limit-override'
import type { LaneEnvironment } from './lane-paths'
import { lane_seed_policy } from './lane-seed'

// How many lanes one repository may run at once, and how many of them are free.
//
// **Nothing here knows what a lane holds.** The limit is a number, the occupancy is a number, and
// the answer is a number — so the same pool serves an epic's children, several epics' children at
// once, or anything else a scheduler decides to put in a lane. Threading an epic through this module
// is what would have to be undone the first time two epics run together, which is why the scheduler
// is epic-free.
//
// **It is a ceiling, not a prediction.** Eight lanes does not say eight children will run at once; it
// says a ninth will not start. What actually runs is bounded by what is runnable, by the port
// seats `lane-seed.ts` can allocate, and by the machine.

// Eight rather than the nine seats `lane_seed_policy` can allocate: the seats are the hard structural
// bound, this is the one a person tunes, and leaving headroom between them means raising the limit
// never lands on "the ports ran out" as its first symptom. joshuafolkken/kit#3788 lowered it from
// six: a week of `lane:stats` showed 1.5 effective lanes, while the hours at five or six lanes held
// the swap peak, the slowest gates and most of the gate and commit failures.
// joshuafolkken/kit#5409 raises it to eight with launch memory admission in the same core budget
// ledger as the gates: memory bounds starts while gate reservations bound overlapping heavy work.
const DEFAULT_LANE_LIMIT = 8
const LANE_LIMIT_KEY = 'JOSH_LANE_LIMIT'
const NO_LANES = 0

// The limit, or why it could not be read.
type LimitChoice = PositiveSetting

// **An invalid value is a hard error, never a silent fall back to the default** — the rule
// `PORT_SEED` already holds to. `name` is what the problem names: `josh lane:limit` reads its argument
// by the same rule.
function read_limit(raw: string | undefined, name: string): LimitChoice {
	return cli_flags.read_positive_setting(raw, name, DEFAULT_LANE_LIMIT)
}

// **A live run's `lane:limit` override outranks the environment**: a running
// parent keeps the environment it started with, so the override is the only way its limit moves. This
// stays the one place the limit is read; the override reader is injected so a test reads none.
async function lane_limit(
	environment: LaneEnvironment = process.env,
	read_override: () => Promise<number | undefined> = lane_limit_override.read_override,
): Promise<LimitChoice> {
	const override = await read_override()

	if (override !== undefined) return { kind: 'limit', limit: override }

	return read_limit(environment[LANE_LIMIT_KEY], LANE_LIMIT_KEY)
}

// **A limit above the seat count is capped at the seats**. `lane:open` refuses
// a tenth lane however high the limit is set, so a limit past the seats offers launches bound to be
// refused.
function seated_limit(limit: number): number {
	return Math.min(limit, lane_seed_policy.LAST_LANE_SEAT)
}

// Never negative: a repository holding more `in-progress` issues than the limit allows — the limit
// was lowered, or a stale label outlived its run — has no free lane, and a negative count read as
// "how many to offer" would be a slice nobody meant.
//
// `seated` counts current port ownership independently of execution places. A saved tree alone
// holds no seat; a suspended process can still hold one while taking no execution place.
function limit_room(limit: number, occupied: number): number {
	return Math.max(NO_LANES, seated_limit(limit) - occupied)
}

function free_lanes(limit: number, occupied: number, seated = occupied): number {
	const by_seats = lane_seed_policy.LAST_LANE_SEAT - seated

	return Math.max(NO_LANES, Math.min(limit_room(limit, occupied), by_seats))
}

const lane_capacity = {
	LANE_LIMIT_KEY,
	free_lanes,
	lane_limit,
	limit_room,
	read_limit,
	seated_limit,
}

export type { LimitChoice }
export { lane_capacity }
