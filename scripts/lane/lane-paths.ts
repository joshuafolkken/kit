import path from 'node:path'

// Where a lane lives on disk, and what its branch is called (joshuafolkken/kit#1490).
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
// any other way** (joshuafolkken/kit#1497). Its `has_same_issue_prefix` reads `/^\d+-/`, so the
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

function lane_branch(issue: string): string {
	return `${issue}${LANE_BRANCH_SUFFIX}`
}

const lane_paths = {
	LANE_BRANCH_SUFFIX,
	LANE_ROOT_KEY,
	default_lane_root,
	lane_branch,
	lane_directory,
	lane_root,
}

export type { LaneEnvironment }
export { lane_paths }
