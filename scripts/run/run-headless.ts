import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_carry, type CarryRead } from './run-carry'
import { run_watcher_guard } from './run-watcher-guard'

// The headless `backlogrun` parent (joshuafolkken/kit#2437). `run:wake` starts a cut's successor as
// `claude -p`, and there a turn that ends is the process that ends: its background `lane:await` and
// `run:progress --wait` are killed with it, so "a background command's exit re-invokes the session"
// (`backlogrun-progress.md` → "The parent keeps no clock of its own") does not hold. A successor that
// ended its turn on a wait therefore ended the run's driver while its lanes were still working.
//
// **The mark is what tells that session apart, and the supervisor is its only writer.** It rides the
// launch's environment (`run-wake-cli.ts`), so an attached session never carries it, and a lane child
// the headless parent dispatches inherits it but is exempted by its own mark — a child ends its turn at
// its own boundaries, never on the parent's lanes.

const HEADLESS_ENV_KEY = 'JOSH_RUN_HEADLESS'
const HEADLESS_VALUE = '1'

type EnvironmentSource = Readonly<Record<string, string | undefined>>

// The environment fragment the supervisor launches a successor with.
function environment(): Record<string, string> {
	return { [HEADLESS_ENV_KEY]: HEADLESS_VALUE }
}

function is_headless(source: EnvironmentSource = process.env): boolean {
	return source[HEADLESS_ENV_KEY] === HEADLESS_VALUE
}

// Only a live, un-handed-off record binds the session to its lanes. After `run:carry --cut` the next
// successor drives them, and after `--end` (`none`) or past the bound (`expired`) there is no run left
// to drive — ending the turn is correct in all three. An unreadable record fails open, as every stop
// rule does (`stop-guard.ts`).
function is_driving(read: CarryRead | undefined): boolean {
	return read?.kind === 'carried' && read.carry.is_handed_off !== true
}

async function read_carry_here(): Promise<CarryRead | undefined> {
	const repository = await run_carry.repository_directory()

	return repository === undefined
		? undefined
		: run_carry.read_carry(run_carry.carry_path(repository))
}

/**
 * Whether this session is a headless parent that would end its run by ending the turn: marked, not a
 * lane child, with lanes still in flight and no cut handed the record off.
 */
async function must_keep_waiting(source: EnvironmentSource = process.env): Promise<boolean> {
	const is_candidate = is_headless(source) && lane_child_marker.marked_issue(source) === undefined

	if (!is_candidate || !(await run_watcher_guard.has_lanes_in_flight())) return false

	return is_driving(await read_carry_here())
}

/**
 * Whether this session is the driving `backlogrun` parent, attached or headless: not a lane child, and
 * holding a live, un-handed-off carry record — the record only a `backlogrun` writes
 * (joshuafolkken/kit#2452).
 */
async function is_backlog_parent(source: EnvironmentSource = process.env): Promise<boolean> {
	if (lane_child_marker.marked_issue(source) !== undefined) return false

	return is_driving(await read_carry_here())
}

const run_headless = {
	HEADLESS_ENV_KEY,
	environment,
	is_backlog_parent,
	is_headless,
	must_keep_waiting,
}

export { run_headless }
