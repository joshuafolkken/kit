import { UNTRACKED_FILES_FLAG } from '#scripts/git/constants'
import { git_command } from '#scripts/git/git-command'
import { git_diff_reads } from '#scripts/git/git-diff-reads'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import type { CutState } from './run-cut'

// Whether a cut can be taken on this tree — the one predicate `run:cut` refuses `unready` on and the
// implementation-cut guard asks before it refuses an edit (joshuafolkken/kit#3881).
//
// **The guard and the command must not disagree.** The guard once fired on every over-threshold edit
// of a run held on the default branch, where `run:cut --impl` can only ever answer `unready`; each
// refusal cost a round trip that cut nothing. Reading the same predicate keeps the guard silent
// exactly where the command would refuse.

interface CutTree {
	branch: string
	default_branch: string
	is_dirty: boolean
}

// A cut needs an uncommitted implementation on a branch other than the default one: the resume
// verifies both, so a tree missing either has nothing a fresh process could resume.
function is_ready(tree: CutTree): boolean {
	return tree.branch !== tree.default_branch && tree.is_dirty
}

// The same predicate over the state `run:cut` reads, against the default branch asked asynchronously.
async function is_lane_branch(state: CutState): Promise<boolean> {
	const default_branch = await git_command.get_default_branch()

	return is_ready({ branch: state.branch, default_branch, is_dirty: state.is_dirty })
}

// `--branch` puts the branch on a `# branch.head` header line, so one call answers both halves; every
// other line is a change.
const STATUS_ARGUMENTS = ['status', '--porcelain=v2', '--branch', UNTRACKED_FILES_FLAG] as const
const HEADER_PREFIX = '#'
const BRANCH_HEADER = '# branch.head '

function tree_of(status: string, default_branch: string): CutTree | undefined {
	const lines = status.split('\n').filter((line) => line !== '')
	const header = lines.find((line) => line.startsWith(BRANCH_HEADER))

	if (header === undefined) return undefined

	const branch = header.slice(BRANCH_HEADER.length)
	const is_dirty = lines.some((line) => !line.startsWith(HEADER_PREFIX))

	return { branch, default_branch, is_dirty }
}

// The tree read synchronously, for the `PreToolUse` guard — `undefined` where git cannot answer.
function read_tree_sync(): CutTree | undefined {
	const status = git_spawn_sync.read(STATUS_ARGUMENTS)

	if (status === undefined) return undefined

	const reference = git_spawn_sync.read(git_diff_reads.DEFAULT_BRANCH_ARGUMENTS)

	return tree_of(status, git_diff_reads.default_branch_of(reference))
}

// **A tree git cannot describe reads as ready**, so the guard keeps speaking rather than going quiet
// on a read fault — the same direction `run_cut.carried_cut_sync` takes for an unreadable record.
function is_ready_sync(read: () => CutTree | undefined = read_tree_sync): boolean {
	const tree = read()

	return tree === undefined || is_ready(tree)
}

const run_cut_ready = { is_lane_branch, is_ready, is_ready_sync, tree_of }

export type { CutTree }
export { run_cut_ready }
