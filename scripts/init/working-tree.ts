import { git_location_environment } from '#scripts/git/git-location-environment'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { start_exec } from './start-exec'

const UNTRACKED_ARGUMENTS = ['ls-files', '--others', '--exclude-standard']
// `--relative` keeps the listing to the project and its paths relative to it, the way `ls-files`
// already reads them, for a project that sits below its repository's top level.
const MODIFIED_ARGUMENTS = ['diff', '--name-only', '--relative', 'HEAD']
const UNBORN_HEAD_EXIT_CODE = 1
const NOT_A_REPOSITORY = 'not a git repository'

// What a project's working tree holds that is not committed, read one way for every setup command:
// the setup pull request tells the setup's files from the user's own with it, and `josh init` refuses
// to write over it.

// Listings are read NUL-separated (`-z`), so a path is never quoted — a name a caller's initialize
// command wrote need not be ASCII the way kit's own are (#2872).
function paths_of(output: string | undefined = ''): Array<string> {
	return output.split('\0').filter((listed) => listed.length > 0)
}

function listing(args: ReadonlyArray<string>, root: string): Array<string> {
	return paths_of(start_exec.git_read([...args, '-z'], root))
}

// Untracked files the ignore rules let through, plus tracked files changed since HEAD, staged or not
// — two plain listings, so nothing has to be parsed out of `git status`.
function changed_paths(root: string): Array<string> {
	const untracked = listing(UNTRACKED_ARGUMENTS, root)
	const modified = listing(MODIFIED_ARGUMENTS, root)

	return [...untracked, ...modified]
}

// A read that failed is thrown rather than read as an empty listing: the refusal guards the user's
// work, so a git that did not answer must never pass for a clean tree.
function strict_listing(args: ReadonlyArray<string>, root: string): Array<string> {
	const output = start_exec.git_read([...args, '-z'], root)

	if (output === undefined) throw new Error(`git ${args.join(' ')} failed in ${root}`)

	return paths_of(output)
}

// Asked of git rather than of a `.git` beside the project, so a project below its repository's top
// level is still found. `--verify --quiet` exits 1 for an unborn HEAD — the repository `josh start` has
// yet to make its first commit in — and only `not a git repository` (read under the C locale) proves
// there is no repository; any other failure is an unanswered question, not a missing commit.
function has_commit(root: string): boolean {
	const { exit_code, stderr } = git_spawn_sync.run(['rev-parse', '--verify', '--quiet', 'HEAD'], {
		cwd: root,
		env: { ...git_spawn_sync.C_LOCALE, ...git_location_environment.location_free_environment() },
	})

	if (exit_code === 0) return true
	if (exit_code === UNBORN_HEAD_EXIT_CODE || stderr.includes(NOT_A_REPOSITORY)) return false
	throw new Error(`git rev-parse could not read HEAD in ${root}`)
}

// Without a commit there is nothing to tell the user's work from — a directory outside any repository,
// or a repository without its first commit — so nothing counts as uncommitted.
function uncommitted_paths(root: string): Array<string> {
	if (!has_commit(root)) return []

	const untracked = strict_listing(UNTRACKED_ARGUMENTS, root)
	const modified = strict_listing(MODIFIED_ARGUMENTS, root)

	return [...untracked, ...modified]
}

// The refusal a setup command stops with before its first write, or undefined when nothing is
// uncommitted: what kit then writes would land in the same files as the user's own work, and
// `git diff` could no longer tell the two apart.
function dirty_tree_refusal(root: string, command: string): string | undefined {
	const paths = uncommitted_paths(root)

	if (paths.length === 0) return undefined

	return [
		`${command} refuses to run: the working tree has uncommitted changes.`,
		...paths.map((listed) => `  ${listed}`),
		`Commit them, or stash them with \`git stash push -u\`, then run ${command} again.`,
	].join('\n')
}

const working_tree = { listing, changed_paths, uncommitted_paths, dirty_tree_refusal }

export { working_tree }
