import { loadavg } from 'node:os'
import { epic_busy } from '#scripts/epic/epic-busy'
import { git_command } from '#scripts/git/git-command'
import type { OpenIssueData } from '#scripts/git/schemas'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_report } from '#scripts/lane/lane-report'
import { run_liveness } from './run-liveness'
import { run_preflight } from './run-preflight'
import type { ChildObservation, LaneObservation, Observations } from './run-progress'
import { run_progress_clock } from './run-progress-clock'

// Everything `josh run:progress` reads: the last-report record that makes the clock a silence clock,
// and the observations one tick puts on the line (joshuafolkken/kit#1520).
//
// **Every reader here is one that already exists.** The children in flight come from
// `epic_busy.read_repository`, which is the same `in-progress` listing `epicrun` sizes its lanes
// from — a second definition of "running" would let the progress line disagree with the loop that
// printed the child. The pull request comes from `run_preflight`, the lanes from `lane_registry`, and
// the transcript sample from `run_liveness.sample_output`, whose symlink-following `statSync` is the
// whole of joshuafolkken/kit#1485; re-`stat`ing the path here would reintroduce that bug.
//
// **The record is kept per work tree**, keyed the way `run_hold` keys its own: two lanes of one
// repository are two runs, and one lane's report must not silence the other's clock.

// The record itself — its name, its shape, and how it is read and written — lives in
// `run-progress-clock.ts`, because the trigger-delivered rule that refuses an early heartbeat reads
// the same record from inside a `PreToolUse` hook and cannot await the git call this file makes
// (joshuafolkken/kit#1570). What stays here is the asynchronous way of naming the work tree.
const { PROGRESS_PREFIX, mark, parse_stamp, read_last_report } = run_progress_clock

const FIRST_LOAD_AVERAGE = 0

// A listing that arrived and had holders, a listing that arrived empty, and a listing that did not
// arrive. All three end in no line being printed, and they are kept apart anyway: only the middle one
// means "there is nothing to report", and saying so for the third would be a confident absence built
// on a read nobody completed.
type ObservationRead =
	{ kind: 'idle' } | { kind: 'observed'; observations: Observations } | { kind: 'unreadable' }

const IDLE_READ: ObservationRead = { kind: 'idle' }
const UNREADABLE_READ: ObservationRead = { kind: 'unreadable' }

// The first of the two paths git prints is this work tree's own; the second is the common directory
// every work tree shares, which is exactly what must not be the key.
async function stamp_target(): Promise<string> {
	const [git_directory] = await git_command.git_directories()

	return run_progress_clock.stamp_target_of(git_directory)
}

function to_labels(issue: OpenIssueData): Array<string> {
	return (issue.labels ?? []).map((label) => label.name)
}

async function to_child(issue: OpenIssueData): Promise<ChildObservation> {
	const number = String(issue.number)
	const child = await run_preflight.read_child_state(number)

	return { issue: number, labels: to_labels(issue), pr_state: child.pr_state }
}

async function read_children(repo: string): Promise<ReadonlyArray<ChildObservation> | undefined> {
	const read = await epic_busy.read_repository(repo)

	if (read.kind === 'idle') return []
	if (read.kind !== 'busy') return undefined

	return await Promise.all(read.issues.map(async (issue) => await to_child(issue)))
}

async function read_lanes(): Promise<ReadonlyArray<LaneObservation>> {
	const lanes = await lane_registry.list_lanes()

	return lanes.map((lane) => ({ issue: lane.issue, state: lane_report.lane_state(lane) }))
}

function is_mtime(value: number | undefined): value is number {
	return value !== undefined
}

/**
 * How long ago the newest delegated unit's transcript last grew — the one field that says a run may be
 * stuck rather than merely slow.
 *
 * `undefined` when no path was given or none of them could be sampled, and the line prints `unread`
 * for it. A run started before any unit exists has nothing to name here, and inventing an age for a
 * file nobody read is the failure this command is built not to commit.
 */
function read_record_age(paths: ReadonlyArray<string>, now_ms: number): number | undefined {
	const times = paths
		.map((output_path) => run_liveness.sample_output(output_path)?.mtime_ms)
		.filter(is_mtime)

	if (times.length === 0) return undefined

	return now_ms - Math.max(...times)
}

interface ObservationRequest {
	now_ms: number
	output_paths: ReadonlyArray<string>
	repo: string
}

async function read_observations(request: ObservationRequest): Promise<ObservationRead> {
	const [children, lanes] = await Promise.all([read_children(request.repo), read_lanes()])

	if (children === undefined) return UNREADABLE_READ
	if (children.length === 0) return IDLE_READ

	const observations: Observations = {
		children,
		lanes,
		load_average: loadavg()[FIRST_LOAD_AVERAGE] ?? 0,
		record_age_ms: read_record_age(request.output_paths, request.now_ms),
	}

	return { kind: 'observed', observations }
}

const run_progress_read = {
	PROGRESS_PREFIX,
	mark,
	parse_stamp,
	read_children,
	read_last_report,
	read_lanes,
	read_observations,
	read_record_age,
	stamp_target,
}

export type { ObservationRead, ObservationRequest }
export { run_progress_read }
