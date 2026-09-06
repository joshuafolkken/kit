import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ENV_FILE_NAME } from '#ports'
import { git_command } from '#scripts/git/git-command'
import { lane_environment } from './lane-environment'
import { lane_paths } from './lane-paths'

// The open lanes, read from git and from each lane's own `.env` (joshuafolkken/kit#1490).
//
// **There is no ledger file, and that is the design rather than an omission.** A lane's seat has to
// live in its `.env` anyway — that file is what `josh port` and `playwright.config.ts` read inside
// the work tree — so keeping a second copy of it anywhere else buys nothing and can disagree with
// the first. Reading the seats back out of the live lanes means `git worktree remove` erases the
// record of a seat along with the tree that held it: there is nothing to keep in step and nothing
// that can go stale. A counter, or a ledger beside the trees, would let a lane that was closed and
// reopened take a seat a running lane is still using.

interface LaneInfo {
	issue: string
	branch: string
	directory: string
	seed: number | undefined
	is_stranded: boolean
}

const WORKTREE_PREFIX = 'worktree '
const BRANCH_PREFIX = 'branch refs/heads/'
const BLOCK_SEPARATOR = '\n\n'
// The same shape `lane:open` accepts. Nothing reserves the `-lane` suffix, so a hand-made
// `spike-lane` branch with a work tree would otherwise be read as a lane — and `lane:close --all`
// would delete its directory and its branch on an issue number that never existed.
const ISSUE_PATTERN = /^[1-9]\d*$/u

function line_value(lines: ReadonlyArray<string>, prefix: string): string | undefined {
	return lines.find((line) => line.startsWith(prefix))?.slice(prefix.length)
}

/**
 * The seed a lane holds, or `undefined` when its `.env` cannot be read.
 *
 * **Unreadable is reported, never treated as free.** A seat read as free is handed to the next lane
 * while the ports it actually holds are still bound, and the collision then surfaces as an E2E
 * failure in a different work tree — the kind of silent failure `playwright.config.ts` refuses to
 * add by dying on a busy port instead of retrying on another.
 */
function seed_from_content(content: string): number | undefined {
	// **A file with no `PORT_SEED` line at all is not seat 0.** `read_root_seed` answers with the
	// documented default of 0 for one, and 0 is the main work tree's own seat — so a lane whose seed
	// line was lost would be booked as sharing it while the lane in fact still runs on whatever ports
	// it was started with, and `lane:open` would allocate straight over them.
	const has_seed = content.split('\n').some((line) => lane_environment.is_seed_line(line))

	return has_seed ? lane_environment.read_root_seed(content) : undefined
}

function read_seed(directory: string): number | undefined {
	try {
		return seed_from_content(readFileSync(path.join(directory, ENV_FILE_NAME), 'utf8'))
	} catch {
		return undefined
	}
}

// A lane is identified by its branch rather than by where it sits, so nothing here compares two
// spellings of one path — git prints the resolved one, and a lane root reached through a symlink
// would otherwise read as no lane at all.
function branch_issue(branch: string | undefined): string | undefined {
	if (!branch?.endsWith(lane_paths.LANE_BRANCH_SUFFIX)) return undefined

	const issue = branch.slice(0, -lane_paths.LANE_BRANCH_SUFFIX.length)

	return ISSUE_PATTERN.test(issue) ? issue : undefined
}

// **Stranded means the work tree is gone from disk, and nothing else.** git also marks a
// registration prunable when its `.git` pointer is damaged while the directory — and whatever server
// is running in it — is still there; read as stranded, that lane's seat would be handed to the next
// one while its ports are still bound.
function is_gone(directory: string): boolean {
	return !existsSync(directory)
}

function build_lane(
	issue: string,
	branch: string,
	directory: string,
	is_stranded: boolean,
): LaneInfo {
	return {
		issue,
		branch,
		directory,
		// A stranded lane binds no ports, so its seat is free and there is nothing to read.
		seed: is_stranded ? undefined : read_seed(directory),
		is_stranded,
	}
}

// **A lane is its branch *and* its place, and the place is what makes the identification safe**
// (joshuafolkken/kit#1497). The branch alone is not a namespace anyone stays out of: `pnpm josh git`
// builds an issue branch as `<N>-<slug of the title>`, so an issue titled "Lane" produces `<N>-lane`
// — byte for byte the name `lane_paths.lane_branch` builds. Read as a lane, that work tree is
// whichever checkout the person was working in, and `lane:close --all` would delete it, because
// `lane-close.ts` → `remove_directory` runs `rmSync` on whatever directory the registry reported.
// Requiring the directory to be exactly `<lane root>/<N>` costs a real lane nothing — `lane:open`
// puts it there and nowhere else — and takes the whole class of collision out. The cost is that a
// lane root reached through a symlink stops reading as a lane; that fails safe, where the branch
// check alone failed destructively.
function is_lane_directory(root: string, issue: string, directory: string): boolean {
	return directory === lane_paths.lane_directory(root, issue)
}

function parse_block(block: string, root: string): LaneInfo | undefined {
	const lines = block.split('\n')
	const directory = line_value(lines, WORKTREE_PREFIX)
	const branch = line_value(lines, BRANCH_PREFIX)
	const issue = branch_issue(branch)

	if (directory === undefined || branch === undefined || issue === undefined) return undefined

	if (!is_lane_directory(root, issue, directory)) return undefined

	return build_lane(issue, branch, directory, is_gone(directory))
}

function is_lane(lane: LaneInfo | undefined): lane is LaneInfo {
	return lane !== undefined
}

// **The lane root is derived from the main work tree, never from the one this ran in.**
// `git rev-parse --show-toplevel` answers the *current* work tree, which inside a lane is the lane
// itself — so `lane:list` run there would look for lanes under `<lane>/.1497-lanes`, find none, and
// report that no lanes are open while six were running. `git worktree list` prints the main work
// tree first and prints the same thing from every work tree, so the answer does not depend on where
// the command was typed. It is the listing this function already reads, so nothing extra is asked.
function main_worktree(blocks: ReadonlyArray<string>): string | undefined {
	return line_value((blocks[0] ?? '').split('\n'), WORKTREE_PREFIX)
}

/** Every open lane of this repository, lowest issue number first. */
async function list_lanes(): Promise<Array<LaneInfo>> {
	const listing = await git_command.worktree_list()
	const blocks = listing.split(BLOCK_SEPARATOR)
	const main = main_worktree(blocks)

	if (main === undefined) return []

	const lanes = blocks
		.map((block) => parse_block(block, lane_paths.lane_root(main)))
		.filter(is_lane)

	return lanes.toSorted((left, right) => Number(left.issue) - Number(right.issue))
}

/** The seeds live lanes hold — what a new lane's seat has to avoid. */
function used_seeds(lanes: ReadonlyArray<LaneInfo>): Array<number> {
	return lanes.map((lane) => lane.seed).filter((seed): seed is number => seed !== undefined)
}

/** The live lanes whose seat could not be read, which is what stops an allocation. */
function unreadable_lanes(lanes: ReadonlyArray<LaneInfo>): Array<LaneInfo> {
	return lanes.filter((lane) => !lane.is_stranded && lane.seed === undefined)
}

function find_lane(lanes: ReadonlyArray<LaneInfo>, issue: string): LaneInfo | undefined {
	return lanes.find((lane) => lane.issue === issue)
}

const lane_registry = {
	find_lane,
	list_lanes,
	parse_block,
	unreadable_lanes,
	used_seeds,
}

export type { LaneInfo }
export { lane_registry }
