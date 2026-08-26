import { execaSync } from 'execa'

// The git probes propagation needs before it writes anything into a working tree.
//
// Propagation commits and pushes. A consumer with uncommitted work would have that work swept into
// the upgrade commit — `josh git` stages the whole tree — and a supplier repository that is behind
// its remote would propagate the *previous* release, which is already published and would report
// success (joshuafolkken/kit#863).

const GIT_TIMEOUT_MS = 10_000
const SUCCESS_EXIT_CODE = 0
const DEFAULT_BRANCH_REF = 'refs/remotes/origin/HEAD'
const FALLBACK_DEFAULT_BRANCH = 'main'
const ORIGIN_PREFIX = 'refs/remotes/origin/'

// What a repository has to be for propagation to write into it, or the reason it is not.
interface TreeState {
	is_ready: boolean
	reason?: string
}

function run_git(repository_path: string, args: ReadonlyArray<string>): string | undefined {
	const result = execaSync('git', args, {
		cwd: repository_path,
		reject: false,
		timeout: GIT_TIMEOUT_MS,
		env: { LC_ALL: 'C', LANGUAGE: 'C' },
		extendEnv: true,
	})

	return result.exitCode === SUCCESS_EXIT_CODE ? result.stdout.trim() : undefined
}

// The repository's default branch, from the remote's own HEAD. Falls back to `main` when the ref is
// missing, which is the case in a fresh clone that never ran `git remote set-head`.
function default_branch(repository_path: string): string {
	const reference = run_git(repository_path, ['symbolic-ref', DEFAULT_BRANCH_REF])
	if (reference?.startsWith(ORIGIN_PREFIX) !== true) return FALLBACK_DEFAULT_BRANCH

	return reference.slice(ORIGIN_PREFIX.length)
}

function current_branch(repository_path: string): string | undefined {
	return run_git(repository_path, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

// Whether the working tree has no changes at all — tracked or untracked. Untracked files count
// because `josh git` stages them too, so leaving them out would let a consumer's scratch files ride
// into the pull request.
function is_clean(repository_path: string): boolean {
	return run_git(repository_path, ['status', '--porcelain']) === ''
}

// Refresh the remote-tracking ref. Without this the comparison below is between two pre-merge refs
// and passes in exactly the situation the check exists for: the seconds after a pull request merged
// on GitHub, when the local checkout has not seen the merge commit yet.
function fetch_branch(repository_path: string, branch: string): void {
	run_git(repository_path, ['fetch', '--quiet', 'origin', branch])
}

// Whether the branch's tip matches its remote. Fetched first, and an unknown answer reads as *not*
// up to date: a repository whose remote ref cannot be resolved is one this command should not start
// committing in, and passing on the unknown is what let a stale checkout
// propagate the previous release.
function is_up_to_date(repository_path: string, branch: string): boolean {
	fetch_branch(repository_path, branch)
	const local = run_git(repository_path, ['rev-parse', branch])
	const remote = run_git(repository_path, ['rev-parse', `origin/${branch}`])
	if (local === undefined || remote === undefined) return false

	return local === remote
}

// Decide from already-gathered facts, so the decision is testable without a repository.
function decide_tree_state(
	branch: string,
	default_name: string,
	is_tree_clean: boolean,
	is_current: boolean,
): TreeState {
	if (!is_tree_clean) return { is_ready: false, reason: 'working tree has uncommitted changes' }

	if (branch !== default_name) {
		return { is_ready: false, reason: `on branch ${branch}, not ${default_name}` }
	}

	return is_current
		? { is_ready: true }
		: { is_ready: false, reason: `${branch} is not up to date` }
}

// Whether a repository is safe to propagate into (or from). Everything unknown reads as not ready:
// a repository git could not describe is not one to start committing in.
function tree_state(repository_path: string): TreeState {
	const branch = current_branch(repository_path)
	if (branch === undefined) return { is_ready: false, reason: 'not a readable git repository' }
	const default_name = default_branch(repository_path)

	return decide_tree_state(
		branch,
		default_name,
		is_clean(repository_path),
		is_up_to_date(repository_path, branch),
	)
}

// Return a checkout to its default branch and pull. Run after a consumer's pull request is opened:
// `josh git` leaves the checkout on the feature branch, and the next propagation's pre-check would
// refuse it for exactly that — so the consumer would silently stop receiving releases.
function return_to_default_branch(repository_path: string): boolean {
	const branch = default_branch(repository_path)
	if (run_git(repository_path, ['checkout', branch]) === undefined) return false

	return run_git(repository_path, ['pull', '--ff-only', 'origin', branch]) !== undefined
}

const propagate_git = {
	default_branch,
	fetch_branch,
	return_to_default_branch,
	current_branch,
	is_clean,
	is_up_to_date,
	decide_tree_state,
	tree_state,
}

export type { TreeState }
export { propagate_git }
