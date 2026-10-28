import { setTimeout as sleep } from 'node:timers/promises'
import { gate_skip } from '#scripts/gate/gate-skip'
import { gate_tree } from '#scripts/gate/gate-tree'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_map_stamp, type FileMapStampAccess } from '#scripts/josh/file-map-stamp'
import { GATE_COMMAND } from '#scripts/josh/josh-command-types'
import { stamp_file } from '#scripts/josh/stamp-file'
import { review_stamps } from '#scripts/review/review-stamps'
import { review_tree } from '#scripts/review/review-tree'
import { detached_launch, type LaunchArgv, type LaunchResult } from '#scripts/run/detached-launch'
import { run_review, type GateState, type ReviewTiming, type TimingStart } from './run-review'

// The side effects `josh run:review` performs, kept out of `run-review.ts` the way `run-merge-steps.ts`
// is kept out of `run-merge.ts`. Three of them (the `test:pinned` check's are in
// `run-review-pinned-steps.ts`): launch the gate detached so one command leaves it running in the
// background, read back the state the join waits on from the stamps a real `josh gate` writes, and
// keep the four timestamps the overlap is measured from.

// Resolve `josh` through the target checkout's package script. Consumer lanes have no source entry.
const PNPM = 'pnpm'
const DIRECTORY_FLAG = '--dir'
const JOSH_SCRIPT = 'josh'
const GATE_LOG_PREFIX = 'josh-run-review-gate-log-'
const TIMING_PREFIX = 'josh-run-review-timing-'
const START_TREE_PREFIX = 'josh-run-review-start-tree-'

// The tree this pair's gate started on, which tells a moved tree from a red gate at the join.
const start_tree_stamp: FileMapStampAccess = file_map_stamp.create(START_TREE_PREFIX, PROJECT_ROOT)

// The gate is a local, no-network command that finishes in tens of seconds; the review it runs beside
// is the longer pole, so by the time the child joins, the gate has almost always already settled. The
// cap is generous rather than tight — a wait that ended early would read a still-running gate as red.
const POLL_INTERVAL_MS = 1000
const MAX_JOIN_WAIT_MS = 600_000

type Clock = () => number

function gate_log_path(root: string = PROJECT_ROOT): string {
	return stamp_file.stamp_path(GATE_LOG_PREFIX, root)
}

function timing_path(target: string = PROJECT_ROOT): string {
	return stamp_file.stamp_path(TIMING_PREFIX, target)
}

// The argv is composed from constants and the validated checkout root, never interpolated into a
// shell string — `detached_launch.launch` refuses one carrying anything a command line has no business
// holding, and there is no shell on the path to escape from.
function josh_argv(root: string, josh_args: ReadonlyArray<string>): LaunchArgv {
	return {
		command: PNPM,
		args: [DIRECTORY_FLAG, root, JOSH_SCRIPT, ...josh_args],
	}
}

// A `josh` command left running in the background, its output kept at `log_path`: the gate, and the
// `test:pinned` check beside it (`run-review-pinned-steps.ts`).
function launch_josh(
	josh_args: ReadonlyArray<string>,
	log_path: string,
	root: string = PROJECT_ROOT,
): LaunchResult {
	return detached_launch.launch(
		{
			argv: josh_argv(root, josh_args),
			cwd: root,
			log_path,
			env: git_location_environment.location_free_environment(),
		},
		(note) => process.stderr.write(`${note}\n`),
	)
}

function launch_gate(root: string = PROJECT_ROOT): LaunchResult {
	return launch_josh([GATE_COMMAND], gate_log_path(root), root)
}

function to_timing(value: unknown): TimingStart | undefined {
	if (typeof value !== 'object' || value === null) return undefined

	const { gate_started_at, review_started_at } = value as Record<string, unknown>

	if (typeof gate_started_at !== 'string' || typeof review_started_at !== 'string') return undefined

	return { gate_started_at, review_started_at }
}

function read_timing_start(target: string = PROJECT_ROOT): TimingStart | undefined {
	const raw = stamp_file.read_stamp_text(timing_path(target))

	if (raw === undefined) return undefined

	try {
		return to_timing(JSON.parse(raw))
	} catch {
		return undefined
	}
}

// **This pair's gate was green on the tree it started on** (joshuafolkken/kit#4774): a green record
// covering that tree is one the gate either wrote or reused, and a red gate leaves only a record it
// could not reuse — so none covers it. Read beside a record that no longer covers the current tree, it
// is the tree that moved after the gate passed — a round-1 reviewer's fix in place — and not a red
// gate. The record's time is no witness: a gate that reused an earlier green writes no new one.
function is_green_on_start_tree(base: string | undefined): boolean {
	const start = start_tree_stamp.read()

	if (start === undefined) return false

	return gate_skip.reusable_green_gate(start.files, base) !== undefined
}

// Green wins over the marker: a gate that has recorded a green result on this tree is done however its
// in-flight marker reads. `reusable_green_gate` is the gate's own reuse test rather than a second copy
// of it, so the join calls a gate green on exactly the trees the gate would skip.
//
// **The marker is read before the green record, never after**. The gate writes its green record
// and only then clears the marker, so a marker read as gone means any green record is already on disk
// for the read that follows. Read the other way round, a gate that recorded green and cleared its
// marker between the two reads would be seen as neither — and the join would answer RED.
async function read_gate_state(): Promise<GateState> {
	const is_running = file_map_stamp.is_writer_running(review_stamps.in_flight_stamp.read())
	const tree = await gate_tree.read_gate_tree()
	const is_green = gate_skip.reusable_green_gate(tree.files, tree.base) !== undefined

	return run_review.gate_state(is_green, is_running, is_green_on_start_tree(tree.base))
}

// The brief has to report the gate as in-flight, or it says `Not verified` and sends the review agent
// to re-run the suite the gate is already running. The detached gate writes
// that marker itself, but its cold start can outrun the brief — so the composite writes the marker up
// front, for the tree it is about to review. The gate overwrites it with its own identity the moment it
// starts and clears it when it finishes, so this only closes the window between launch and that write;
// the marker carries this process's identity, which is live while the in-process brief reads it. The
// same tree is kept as the pair's start tree, which the gate clears no marker of.
async function mark_gate_starting(): Promise<void> {
	const tree = await review_tree.read_changed_tree()

	review_stamps.in_flight_stamp.write(tree)
	start_tree_stamp.write(tree)
}

// Waited on gate finish, for the join. The review is the longer pole, so this usually returns on its
// first read; the cap only bounds a gate that hung, which reads as red rather than blocking for ever.
async function wait_for_gate_finish(now: Clock = () => Date.now()): Promise<GateState> {
	const started = now()
	let state = await read_gate_state()

	while (!run_review.is_gate_settled(state) && now() - started < MAX_JOIN_WAIT_MS) {
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await sleep(POLL_INTERVAL_MS)
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		state = await read_gate_state()
	}

	return state
}

function read_gate_log(root: string = PROJECT_ROOT): string | undefined {
	return stamp_file.read_stamp_text(gate_log_path(root))
}

function write_timing_start(start: TimingStart, target: string = PROJECT_ROOT): void {
	stamp_file.write_stamp(timing_path(target), start)
}

// The two ends are stamped at the join: the review ended when the child returned from the subagent and
// called this, and the gate ended at the green stamp's time where it passed, or now where it did not.
function complete_timing(
	ended: { gate_ended_at: string; review_ended_at: string },
	target: string = PROJECT_ROOT,
): ReviewTiming | undefined {
	const start = read_timing_start(target)

	if (start === undefined) return undefined

	return { ...start, ...ended }
}

const run_review_steps = {
	MAX_JOIN_WAIT_MS,
	POLL_INTERVAL_MS,
	complete_timing,
	gate_log_path,
	launch_gate,
	launch_josh,
	mark_gate_starting,
	read_gate_log,
	read_gate_state,
	read_timing_start,
	start_tree_stamp,
	timing_path,
	wait_for_gate_finish,
	write_timing_start,
}

export { run_review_steps }
