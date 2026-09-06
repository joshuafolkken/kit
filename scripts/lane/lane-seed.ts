import { PORT_SEED_KEY, ports } from '#ports'
import { lane_environment } from './lane-environment'
import type { LaneEnvironment } from './lane-paths'

// Which port seed a lane gets (joshuafolkken/kit#1490).

const LANE_SEED_BASE_KEY = 'JOSH_LANE_SEED_BASE'
// **The main work tree is seat 0, and nothing here can move it.** Lanes start at base+1, so a
// project that has never opened one stays on exactly the ports `ports/index.js` already gives it —
// the bases themselves for an unset seed, which is what CI runs on. A design that let lanes consume
// numbers from the first one would shift every existing checkout's ports the moment this landed.
const FIRST_LANE_SEAT = 1
// **Nine seats, and the number comes from the port bases rather than from roundness.**
// `ports/index.js` offsets the dev port and the preview port by the same seed, and the two bases sit
// exactly `SEED_CEILING` apart — so one project's preview port becomes another project's dev port as
// soon as their seeds differ by that much. Keeping every seed below the ceiling makes that collision
// structurally impossible. The way to spend the space is one base seed per project on a multiple of
// ten with its lanes on base+1..base+9: nine seats against a default of six lanes, and a hundred
// projects inside the limit.
const LAST_LANE_SEAT = 9
const SEED_CEILING = 1000
const HIGHEST_USABLE_BASE = SEED_CEILING - LAST_LANE_SEAT - 1

function fail_out_of_band(base: number): never {
	throw new Error(
		`A lane seed would reach ${String(SEED_CEILING)}: the base seed is ${String(base)} and a lane takes base+${String(FIRST_LANE_SEAT)}..base+${String(LAST_LANE_SEAT)}. ` +
			`Every seed has to stay under ${String(SEED_CEILING)}, because the dev and preview port bases are exactly that far apart: two seeds ${String(SEED_CEILING)} apart put one project's preview on another project's dev port. ` +
			`Set ${LANE_SEED_BASE_KEY} in .env to a free multiple of ten no higher than ${String(HIGHEST_USABLE_BASE)}.`,
	)
}

function read_base(root_content: string, environment: LaneEnvironment): number {
	const configured = environment[LANE_SEED_BASE_KEY]?.trim() ?? ''

	if (configured.length === 0) return lane_environment.read_root_seed(root_content)

	return ports.resolve_seed({ [PORT_SEED_KEY]: configured })
}

/**
 * The seed lanes are numbered from — this project's own `PORT_SEED` unless told otherwise.
 *
 * The root checkout keeps that seed itself and lanes take the numbers above it, so a lane never
 * collides with the tree it was opened from. An explicit `JOSH_LANE_SEED_BASE` is for the machine
 * whose root seed is already adjacent to another project's; without one the root's own `PORT_SEED`
 * is the base, which is what keeps a project that has never heard of lanes where it is.
 */
function seed_base(root_content: string, environment: LaneEnvironment = process.env): number {
	const base = read_base(root_content, environment)

	if (base + LAST_LANE_SEAT >= SEED_CEILING) fail_out_of_band(base)

	return base
}

/**
 * The lowest seed in this project's band that no live lane holds, or `undefined` when all nine are.
 *
 * **Lowest-free, read from the lanes themselves — never from a counter.** A number derived from how
 * many lanes have ever been opened hands a closed-and-reopened lane the seat a running lane is
 * still using; the seats here come from the `.env` of each open work tree, so closing one frees its
 * seat and nothing else has to be told. **Exhaustion answers `undefined` and the caller fails on
 * it**: the band is never wrapped, because wrapping is that same collision under a friendlier name.
 */
function allocate_seed(base: number, used: ReadonlyArray<number>): number | undefined {
	const taken = new Set(used)

	for (let seat = FIRST_LANE_SEAT; seat <= LAST_LANE_SEAT; seat += 1) {
		if (!taken.has(base + seat)) return base + seat
	}

	return undefined
}

const lane_seed_policy = {
	FIRST_LANE_SEAT,
	HIGHEST_USABLE_BASE,
	LANE_SEED_BASE_KEY,
	LAST_LANE_SEAT,
	SEED_CEILING,
	allocate_seed,
	seed_base,
}

export { lane_seed_policy }
