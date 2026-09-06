import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ENV_FILE_NAME } from '#ports'
import { git_command } from '#scripts/git/git-command'
import { lane_environment } from './lane-environment'
import { lane_paths } from './lane-paths'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_seed_policy } from './lane-seed'

// Opening a lane: one linked work tree, one branch, one port seed (joshuafolkken/kit#1490).
//
// **The reading side of a linked work tree already worked; only the creating side was missing.**
// `git_directories()` resolves the tree's own git directory, `run-hold.ts` keys its record on it and
// `repo-discovery.ts` follows a `.git` file pointer — so a lane opened here is guarded, discovered
// and checked by the layers that are already there. Nothing below re-implements any of that.

interface LanePlan {
	lane: LaneInfo
	environment_content: string
}

type OpenOutcome =
	{ kind: 'already-open'; lane: LaneInfo } | { kind: 'full' } | { kind: 'opened'; lane: LaneInfo }

const FULL_OUTCOME: OpenOutcome = { kind: 'full' }

// A root with no `.env` is the normal state of a fresh clone and of CI, and it means seed 0 — the
// same reading `ports/index.js` gives a missing file. The lane still gets a file, because the seed
// it is being given is the whole point.
function read_root_environment(repository_root: string): string {
	const file = path.join(repository_root, ENV_FILE_NAME)

	return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

function build_lane(root: string, issue: string, seed: number): LaneInfo {
	return {
		issue,
		branch: lane_paths.lane_branch(issue),
		directory: lane_paths.lane_directory(root, issue),
		seed,
		is_stranded: false,
	}
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

function build_plan(
	repository_root: string,
	root: string,
	issue: string,
	lanes: ReadonlyArray<LaneInfo>,
): LanePlan | undefined {
	const root_content = read_root_environment(repository_root)
	const base = lane_seed_policy.seed_base(root_content)
	const seed = lane_seed_policy.allocate_seed(base, lane_registry.used_seeds(lanes))

	if (seed === undefined) return undefined

	return {
		lane: build_lane(root, issue, seed),
		environment_content: lane_environment.lane_file_content(root_content, seed),
	}
}

// The `.env` is written straight after the work tree exists, because the seed is the reason the
// lane is being opened. Nothing else is recorded anywhere: that file *is* the record.
async function materialize(plan: LanePlan): Promise<void> {
	mkdirSync(path.dirname(plan.lane.directory), { recursive: true })

	const start_point = await git_command.get_default_branch()

	await git_command.worktree_add(plan.lane.directory, plan.lane.branch, start_point)
	writeFileSync(path.join(plan.lane.directory, ENV_FILE_NAME), plan.environment_content)
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
