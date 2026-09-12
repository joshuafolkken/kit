import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ENV_FILE_NAME } from '#ports'
import { git_worktree } from '#scripts/git/git-worktree'
import { lane_environment } from './lane-environment'
import { lane_install, type InstallResult } from './lane-install'
import { lane_paths } from './lane-paths'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_seed_policy } from './lane-seed'
import { lane_start_point } from './lane-start-point'

// Opening a lane: one linked work tree, one branch, one port seed, and the dependencies to run in it
// (joshuafolkken/kit#1490, joshuafolkken/kit#1554).
//
// **The reading side of a linked work tree already worked; only the creating side was missing.**
// `git_directories()` resolves the tree's own git directory, `run-hold.ts` keys its record on it and
// `repo-discovery.ts` follows a `.git` file pointer — so a lane opened here is guarded, discovered
// and checked by the layers that are already there. Nothing below re-implements any of that.

interface LanePlan {
	lane: LaneInfo
	environment_content: string
	// The seat lock held across this lane's creation, released once its `.env` is on disk.
	seat_lock: string
}

interface SeatReservation {
	seat: number
	lock: string
}

type OpenOutcome =
	{ kind: 'already-open'; lane: LaneInfo } | { kind: 'full' } | { kind: 'opened'; lane: LaneInfo }

const FULL_OUTCOME: OpenOutcome = { kind: 'full' }

// The seat a lane will take is claimed by exclusively creating its lock directory here, under the
// lanes root and clear of the lanes themselves (which are numbered, never dot-prefixed). The claim
// is what closes the gap between reading the free seats and writing the lane's `.env`: two
// `lane:open` runs that both saw seat 1 free cannot both create the same lock, so the loser steps to
// the next free seat (joshuafolkken/kit#1494). The lock is released once the lane's `.env` is on
// disk and the seat is discoverable — or on any failure — so only a hard crash mid-open can strand
// one, which removing the lanes-root `.seat-locks` directory clears.
const SEAT_LOCK_DIR = '.seat-locks'

// A root with no `.env` is the normal state of a fresh clone and of CI, and it means seed 0 — the
// same reading `ports/index.js` gives a missing file. The lane still gets a file, because the seed
// it is being given is the whole point.
function read_root_environment(repository_root: string): string {
	const file = path.join(repository_root, ENV_FILE_NAME)

	return existsSync(file) ? readFileSync(file, 'utf8') : ''
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

function seat_lock_path(root: string, seat: number): string {
	return path.join(root, SEAT_LOCK_DIR, `seat-${String(seat)}`)
}

// Claim `lock` by creating it exclusively — `false` when another open already holds it. The parent
// is ensured first (idempotent); the lock itself is a non-recursive `mkdirSync`, so an existing one
// throws rather than passing silently, which is what makes the claim atomic.
function claim_seat(lock: string): boolean {
	mkdirSync(path.dirname(lock), { recursive: true })

	try {
		mkdirSync(lock)

		return true
	} catch {
		return false
	}
}

function reserve_seat(root: string, free: ReadonlyArray<number>): SeatReservation | undefined {
	for (const seat of free) {
		const lock = seat_lock_path(root, seat)
		if (claim_seat(lock)) return { seat, lock }
	}

	return undefined
}

/**
 * Refuse to allocate while a live lane's seat cannot be read.
 *
 * Skipping such a lane would read its seat as free and hand its ports to the new one, which is a
 * collision nothing reports until an E2E run fails somewhere else. Failing here names the lane and
 * what to do about it.
 */
function guard_unreadable(lanes: ReadonlyArray<LaneInfo>): void {
	const unreadable = lane_registry.unreadable_lanes(lanes)

	if (unreadable.length === 0) return

	const named = unreadable.map((lane) => `#${lane.issue} (${lane.directory})`).join(', ')

	throw new Error(
		`Cannot read the port seed of these open lanes, so a free seat cannot be chosen: ${named}. Restore each lane's ${ENV_FILE_NAME}, or close the lane with \`pnpm josh lane:close <issue-number>\`.`,
	)
}

/**
 * Fail the open when the install failed, rather than handing back a lane nothing runs in.
 *
 * Reported as a success, the caller captures the directory and types the first `pnpm josh …` in it —
 * which fails with `tsx: command not found`, the exact failure the install exists to remove, now
 * with a success line printed above it (joshuafolkken/kit#1554). The work tree is left where it is
 * because both ways out need it there: the install can be run again against it, or `lane:close` can
 * take it away. The child's own output is carried along, since it is the only thing that says which
 * of the two applies.
 */
function guard_install(lane: LaneInfo, result: InstallResult): void {
	if (result.is_installed) return

	throw new Error(
		`Opened a lane for #${lane.issue} at ${lane.directory}, but installing its dependencies failed, so no \`pnpm josh …\` will run there. Finish it with \`pnpm --dir ${lane.directory} install --frozen-lockfile\`, or take it away with \`pnpm josh lane:close ${lane.issue}\`.\n${result.output}`,
	)
}

function build_plan(
	repository_root: string,
	root: string,
	issue: string,
	lanes: ReadonlyArray<LaneInfo>,
): LanePlan | undefined {
	const root_content = read_root_environment(repository_root)
	const free = lane_seed_policy.free_seats(lane_registry.used_seats(lanes))
	const reservation = reserve_seat(root, free)

	if (reservation === undefined) return undefined

	const environment_content = lane_environment.lane_file_content(root_content, reservation.seat)

	return {
		lane: build_lane(root, issue, reservation.seat, environment_content),
		environment_content,
		seat_lock: reservation.lock,
	}
}

// The `.env` is written straight after the work tree exists, because the seed is the reason the
// lane is being opened. Nothing else is recorded anywhere: that file *is* the record.
//
// The start point comes from `lane_start_point` rather than from the default branch's bare name:
// that name resolves to a local ref nothing advances, and the lane would start without the work
// merged just before it (joshuafolkken/kit#1535). **It answers `undefined` when a branch of this
// lane's name already exists**, which puts the work tree on that branch instead of creating one —
// the only route back to a child that was parked after pushing (joshuafolkken/kit#1627).
//
// **The install is the last step rather than a caller's, because a lane without it is unusable**
// (joshuafolkken/kit#1554). Leaving it to whoever opened the lane made it a step nothing enforced,
// and every lane opened without it failed on its first `pnpm josh …`. It runs after the `.env`
// rather than before, so a lane that fails here still carries the seat it was allocated and the
// failure is recoverable by re-running the install alone.
async function materialize(plan: LanePlan): Promise<void> {
	// The seat lock is released in `finally`: on success the `.env` is on disk and the seat is
	// discoverable by the next open, and on failure nothing was created that should hold it.
	try {
		mkdirSync(path.dirname(plan.lane.directory), { recursive: true })

		const start_point = await lane_start_point.resolve_for_branch(plan.lane.branch)

		await git_worktree.worktree_add(plan.lane.directory, plan.lane.branch, start_point)
		writeFileSync(path.join(plan.lane.directory, ENV_FILE_NAME), plan.environment_content)
		guard_install(plan.lane, await lane_install.install_dependencies(plan.lane.directory))
	} finally {
		rmSync(plan.seat_lock, { recursive: true, force: true })
	}
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
	// `list_lanes` cannot see, on ports it never recorded (joshuafolkken/kit#1497).
	const repository_root = await lane_registry.main_repository_root()
	const lanes = await lane_registry.list_lanes()
	const existing = lane_registry.find_lane(lanes, issue)

	if (existing !== undefined) return { kind: 'already-open', lane: existing }

	guard_unreadable(lanes)

	const root = lane_paths.lane_root(repository_root)
	const plan = build_plan(repository_root, root, issue, lanes)

	if (plan === undefined) return FULL_OUTCOME

	await materialize(plan)

	return { kind: 'opened', lane: plan.lane }
}

const lane_open = {
	build_plan,
	guard_unreadable,
	open_lane,
	read_root_environment,
}

export type { LanePlan, OpenOutcome }
export { lane_open }
