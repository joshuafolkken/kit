import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_reap } from '#scripts/lane/lane-reap'
import { run_carry, type CarryRead, type RunCarry } from './run-carry'
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

// The live record itself, whoever owns it — the run's scope (`--only`, the named list) is the run's,
// not the session's, so the readers that narrow the pool to it need no ownership test.
async function current_carry(): Promise<RunCarry | undefined> {
	const read = await read_carry_here()

	return read?.kind === 'carried' ? read.carry : undefined
}

// **A live record binds only the session that declared it** (joshuafolkken/kit#2472). A cut's
// successor adopts the record and rewrites its owner, and every session in this checkout reads that
// same file — so without this test the session that cut, still attached, read as a second parent. The
// owner is `--owner "$PPID"`, the session process, which is an ancestor of every hook it runs; a
// record that declared no owner proves no one is its parent.
function is_owned_here(carry: RunCarry, ancestry: () => ReadonlySet<number>): boolean {
	return carry.owner_pid !== undefined && ancestry().has(carry.owner_pid)
}

function is_driven_here(read: CarryRead | undefined, ancestry: () => ReadonlySet<number>): boolean {
	if (read?.kind !== 'carried' || !is_driving(read)) return false

	return is_owned_here(read.carry, ancestry)
}

/**
 * Whether this session is the driving `backlogrun` parent, attached or headless: not a lane child, and
 * the declared owner of a live, un-handed-off carry record — the record only a `backlogrun` writes
 * (joshuafolkken/kit#2452, joshuafolkken/kit#2472).
 */
async function is_backlog_parent(
	source: EnvironmentSource = process.env,
	ancestry: () => ReadonlySet<number> = lane_reap.own_ancestry,
): Promise<boolean> {
	if (lane_child_marker.marked_issue(source) !== undefined) return false

	return is_driven_here(await read_carry_here(), ancestry)
}

const run_headless = {
	HEADLESS_ENV_KEY,
	current_carry,
	environment,
	is_backlog_parent,
	is_headless,
	must_keep_waiting,
}

export { run_headless }
