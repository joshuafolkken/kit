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
// The same shape `lane:open` accepts. Nothing reserves the `lane/` prefix, so a hand-made
// `lane/spike` branch with a work tree would otherwise be read as a lane — and `lane:close --all`
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
	if (!branch?.startsWith(lane_paths.LANE_BRANCH_PREFIX)) return undefined

	const issue = branch.slice(lane_paths.LANE_BRANCH_PREFIX.length)

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

function parse_block(block: string): LaneInfo | undefined {
	const lines = block.split('\n')
	const directory = line_value(lines, WORKTREE_PREFIX)
	const branch = line_value(lines, BRANCH_PREFIX)
	const issue = branch_issue(branch)

	if (directory === undefined || branch === undefined || issue === undefined) return undefined

	return build_lane(issue, branch, directory, is_gone(directory))
}

function is_lane(lane: LaneInfo | undefined): lane is LaneInfo {
	return lane !== undefined
}

/** Every open lane of this repository, lowest issue number first. */
async function list_lanes(): Promise<Array<LaneInfo>> {
	const listing = await git_command.worktree_list()
	const blocks = listing.split(BLOCK_SEPARATOR)
	const lanes = blocks.map((block) => parse_block(block)).filter(is_lane)

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
