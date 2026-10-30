import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { ENV_FILE_NAME } from '#ports'
import { git_worktree } from '#scripts/git/git-worktree'
import { session_cite } from '#scripts/issue/session-cite'
import { file_reader } from '#scripts/lib/read-file'
import { eslint_warm } from '#scripts/lint/eslint-warm'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { lane_cache } from './lane-cache'
import { lane_environment } from './lane-environment'
import { lane_install, type InstallResult } from './lane-install'
import { lane_leftover } from './lane-leftover'
import { lane_paths } from './lane-paths'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_seat, type SeatReservation } from './lane-seat'
import { lane_start_point } from './lane-start-point'
import { lane_state } from './lane-state'

// Opening a lane: one linked work tree, one branch, one port seed, and the dependencies to run in it.
//
// **The reading side of a linked work tree already worked; only the creating side was missing.**
// `git_directories()` resolves the tree's own git directory, `run-hold.ts` keys its record on it and
// `repo-discovery.ts` follows a `.git` file pointer — so a lane opened here is guarded, discovered
// and checked by the layers that are already there. Nothing below re-implements any of that.

interface LanePlan {
	lane: LaneInfo
	environment_content: string
	// The seat lock covers creation and installation; dispatch acquires its own lease.
	reservation: SeatReservation
}

type OpenOutcome =
	{ kind: 'already-open'; lane: LaneInfo } | { kind: 'full' } | { kind: 'opened'; lane: LaneInfo }

const FULL_OUTCOME: OpenOutcome = { kind: 'full' }

// A root with no `.env` is the normal state of a fresh clone and of CI, and it means seed 0 — the
// same reading `ports/index.js` gives a missing file. The lane still gets a file, because the seed
// it is being given is the whole point.
function read_root_environment(repository_root: string): string {
	const file = path.join(repository_root, ENV_FILE_NAME)

	return file_reader.read_file_or_empty(file)
}

function build_lane(
	root: string,
	issue: string,
	seat: number,
	environment_content: string,
): LaneInfo {
	// The ports are resolved from the exact `.env` the lane will carry, through the one formula in
	// `ports/index.js`, so the opened-lane confirmation prints the numbers the lane will actually run.
	const port_pair = lane_environment.read_lane_ports(environment_content)

	return {
		issue,
		branch: lane_paths.lane_branch(issue),
		directory: lane_paths.lane_directory(root, issue),
		seat,
		development_port: port_pair.development,
		preview_port: port_pair.preview,
		output: undefined,
		is_stranded: false,
	}
}

/**
 * Fail the open when the install failed, rather than handing back a lane nothing runs in.
 *
 * Reported as a success, the caller captures the directory and types the first `pnpm josh …` in it —
 * which fails with `tsx: command not found`, the exact failure the install exists to remove, now
 * with a success line printed above it. The work tree is left where it is
 * because both ways out need it there: the install can be run again against it, or `lane:close` can
 * take it away. The child's own output is carried along, since it is the only thing that says which
 * of the two applies.
 */
function guard_install(lane: LaneInfo, result: InstallResult): void {
	if (result.is_installed) return

	throw new Error(
		`Opened a lane for ${session_cite.issue(lane.issue)} at ${lane.directory}, but installing its dependencies failed, so no \`pnpm josh …\` will run there. Finish it with \`pnpm --dir ${lane.directory} install --frozen-lockfile\`, or take it away with \`pnpm josh lane:close ${lane.issue}\`.\n${result.output}`,
	)
}

// **The install is said on the run's stream as it starts**: it is the long part of opening a lane, and
// `run:board` draws it apart from the work tree being made. Best-effort, as every stage is.
// **The eslint daemon is warmed once the install lands, unawaited**, so the child's first edit hook
// lints warm rather than paying the daemon's start (joshuafolkken/kit#4720).
async function fill(lane: LaneInfo): Promise<void> {
	await run_event_setup.emit(run_event_setup.installing(lane.issue))
	guard_install(lane, await lane_install.install_dependencies(lane.directory))
	eslint_warm.start(lane.directory)
}

async function build_plan(
	repository_root: string,
	root: string,
	issue: string,
): Promise<LanePlan | undefined> {
	const root_content = read_root_environment(repository_root)
	const reservation = await lane_seat.reserve(root, issue)

	if (reservation === undefined) return undefined

	const environment_content = lane_environment.lane_file_content(root_content, reservation.seat)

	return {
		lane: build_lane(root, issue, reservation.seat, environment_content),
		environment_content,
		reservation,
	}
}

async function add_worktree(lane: LaneInfo): Promise<void> {
	mkdirSync(path.dirname(lane.directory), { recursive: true })

	const start_point = await lane_start_point.resolve_for_branch(lane.branch)

	await git_worktree.worktree_add(lane.directory, lane.branch, start_point)
	await git_worktree.set_upstream(lane.branch)
}

// The `.env` is written straight after the work tree exists, because the seed is the reason the
// lane is being opened. Nothing else is recorded anywhere: that file *is* the record.
//
// The start point comes from `lane_start_point` rather than from the default branch's bare name:
// that name resolves to a local ref nothing advances, and the lane would start without the work
// merged just before it. **It answers `undefined` when a branch of this
// lane's name already exists**, which puts the work tree on that branch instead of creating one —
// the only route back to a child that was parked after pushing.
//
// **The install is the last step rather than a caller's, because a lane without it is unusable**.
// Leaving it to whoever opened the lane made it a step nothing enforced,
// and every lane opened without it failed on its first `pnpm josh …`. It runs after the `.env`
// rather than before, so a lane that fails here still carries the seat it was allocated and the
// failure is recoverable by re-running the install alone.
//
// **The gate's verification caches are seeded from the main checkout before the install**,
// so the lane's first `josh gate` is warm rather than cold. The pre-built
// hook bundles are seeded the same way: `dist/hooks/` is git-ignored, so a
// lane's work tree never carries it and every Claude Code hook drops to the slow `pnpm josh …`
// fallback without this copy. Both are best-effort and run after the `.env` write for the same reason
// the install does: a lane whose warming found nothing still carries its seat and is perfectly
// usable, cold first gate and fallback hooks and all.
async function materialize(plan: LanePlan, source_root: string): Promise<void> {
	// Keep the reservation until installation ends, including its failure paths.
	try {
		await add_worktree(plan.lane)
		lane_registry.write_environment(plan.lane.directory, plan.environment_content)
		lane_cache.seed_caches(source_root, plan.lane.directory)
		lane_cache.seed_hook_bundles(source_root, plan.lane.directory)
		await fill(plan.lane)
	} finally {
		lane_seat.release(plan.reservation)
	}
}

// Both refusals run before the seat is claimed, so neither leaves a lock behind. A directory at the
// lane's path that git does not register is `lane_leftover`'s to remove or refuse.
async function clear_the_way(
	root: string,
	issue: string,
	lanes: ReadonlyArray<LaneInfo>,
): Promise<void> {
	lane_seat.guard_readable(root, lanes)
	await lane_leftover.reclaim(lane_paths.lane_directory(root, issue))
}

// The lane's state record starts here, so no lane opened from now on is without one.
async function opened(lane: LaneInfo): Promise<OpenOutcome> {
	await lane_state.record_change({ issue: lane.issue, state: 'open', command: 'lane:open' })

	return { kind: 'opened', lane }
}

/**
 * Open the lane for `issue`, or say why it was not opened.
 *
 * A lane that is already open is never reopened — including a stranded one, whose registration git
 * still holds and would refuse `worktree add` on. `lane:close` and `lane:prune` are the way out of
 * both, and the refusal says so.
 */
async function open_lane(issue: string): Promise<OpenOutcome> {
	// The main work tree's, never this one's: run from inside a lane, the current root would put the
	// new lane under `<lane>/.<lane>-lanes` and read the lane's own seed as the root's — a lane
	// `list_lanes` cannot see, on ports it never recorded.
	const repository_root = await lane_registry.main_repository_root()
	const lanes = await lane_registry.list_lanes()
	const existing = lane_registry.find_lane(lanes, issue)

	if (existing !== undefined) return { kind: 'already-open', lane: existing }

	const root = lane_paths.lane_root(repository_root)

	await clear_the_way(root, issue, lanes)

	const plan = await build_plan(repository_root, root, issue)

	if (plan === undefined) return FULL_OUTCOME

	await materialize(plan, repository_root)

	return await opened(plan.lane)
}

const lane_open = {
	open_in_flight_count: lane_seat.open_in_flight_count,
	open_lane,
}

export type { OpenOutcome }
export { lane_open }
