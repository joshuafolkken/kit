import path from 'node:path'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'

// Where a lane lives on disk, and what its branch is called.
//
// **A lane is deliberately not nested inside the repository.** A linked work tree is a second full
// checkout, so putting it under the main one would hand every path-walking tool in the project a
// duplicate of itself: the lint run, the unit suite, the spell check and `git status` would each
// have to be taught to skip it, and one missed ignore rule turns a six-lane machine into six
// copies of the tree being checked. A hidden sibling directory of the repository root is outside
// every one of those walks by construction, and needs no ignore entry in kit or in any consumer
// `josh sync` reaches.

const LANE_ROOT_KEY = 'JOSH_LANE_ROOT'
const LANE_DIRECTORY_SUFFIX = '-lanes'
// **The issue number comes first because `pnpm josh git` will not commit from a branch that starts
// any other way**. Its `has_same_issue_prefix` reads `/^\d+-/`, so the
// original `lane/<N>` spelling made every lane a checkout nothing could be committed from — and
// switching the branch inside the lane is not the way round it, because `lane_registry` identifies a
// lane *by* this name: the moment it changes, the work tree drops out of `lane:list`, its seat is
// re-issued to the next lane, and two live lanes share the dev and preview ports lanes exist to keep
// apart. The name is therefore fixed at both ends at once rather than adapted at one of them.
const LANE_BRANCH_SUFFIX = '-lane'

type LaneEnvironment = Record<string, string | undefined>

// `.kit-lanes` beside `kit`, `.app-kit-lanes` beside `app-kit`. Named after the repository rather
// than shared between them, so two projects' lanes never contend for one directory.
function default_lane_root(repository_root: string): string {
	const name = path.basename(repository_root)

	return path.join(path.dirname(repository_root), `.${name}${LANE_DIRECTORY_SUFFIX}`)
}

// A blank override is the shape of "I have not set this", exactly as `PORT_SEED`'s is: `.env.example`
// ships keys with no value, so reading blank as a path would put every lane at the filesystem root.
function lane_root(repository_root: string, environment: LaneEnvironment = process.env): string {
	const configured = environment[LANE_ROOT_KEY]?.trim() ?? ''

	return configured.length === 0 ? default_lane_root(repository_root) : path.resolve(configured)
}

function lane_directory(root: string, issue: string): string {
	return path.join(root, issue)
}

// Built from the suffix above rather than spelled again, so the two readings of a lane root cannot
// drift apart. `.kit-lanes` and `.app-kit-lanes` both match; a plain `lanes` does not, because
// `default_lane_root` always writes the leading dot.
const DEFAULT_LANE_ROOT_PATTERN = new RegExp(String.raw`^\..+${LANE_DIRECTORY_SUFFIX}$`, 'u')

function is_lane_root(directory: string, environment: LaneEnvironment): boolean {
	const configured = environment[LANE_ROOT_KEY]?.trim() ?? ''

	if (configured.length > 0) return path.resolve(configured) === directory

	return DEFAULT_LANE_ROOT_PATTERN.test(path.basename(directory))
}

// **The inverse of `lane_directory`, and the one lane test that needs no git.** `lane_registry`
// answers the same question authoritatively by parsing `git worktree list`, but that read is
// asynchronous and a `PreToolUse` guard is synchronous by contract — so a guard that has to know
// whether the checkout it is running in is a lane reads it off the path instead.
// It is deliberately the weaker of the two: it says the directory *sits
// where a lane sits*, never that a work tree is registered there, so a caller that needs the
// registration still goes through `lane_registry`.
//
// A lane directory's own name is the issue number, so the number a checkout belongs to is readable
// from its path alone.
function lane_issue_of(
	directory: string,
	environment: LaneEnvironment = process.env,
): string | undefined {
	const resolved = path.resolve(directory)
	const issue = path.basename(resolved)

	if (!issue_number_shape.ISSUE_NUMBER_PATTERN.test(issue)) return undefined

	return is_lane_root(path.dirname(resolved), environment) ? issue : undefined
}

function lane_branch(issue: string): string {
	return `${issue}${LANE_BRANCH_SUFFIX}`
}

// The lanes root's own bookkeeping, beside the lanes and never one of them: `lane:open` claims a seat
// by creating a lock directory under it.
const SEAT_LOCK_DIR = '.seat-locks'

// A name the lane machinery writes into a lanes root: a lane's issue number, or a lanes root of its
// own — the nested one a lane opened from inside a lane once put there. Anything else in the root
// was put there by someone else.
function is_lane_entry(name: string): boolean {
	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(name) || DEFAULT_LANE_ROOT_PATTERN.test(name)
}

const lane_paths = {
	LANE_BRANCH_SUFFIX,
	LANE_ROOT_KEY,
	SEAT_LOCK_DIR,
	default_lane_root,
	is_lane_entry,
	lane_branch,
	lane_directory,
	lane_issue_of,
	lane_root,
}

export type { LaneEnvironment }
export { lane_paths }
