import { start_exec } from './start-exec'

// The first commit of a new repository, shared by `josh start` and `josh dogfood:commit` so neither
// keeps a copy of how it is made.

const DEFAULT_BRANCH = 'main'

function create_repository(root: string): void {
	start_exec.git_run(['init', `--initial-branch=${DEFAULT_BRANCH}`], root)
}

function commit_all(root: string): void {
	start_exec.git_run(['add', '--all'], root)
	// The first commit of a new repository has no branch to come from, so the hook that keeps commits
	// off main — installed by the initialize step in a full project — would refuse the only commit
	// that has to land there.
	start_exec.git_run(['commit', '--no-verify', '--message', 'Initial commit'], root)
	// A repository created by an older `git init` may name its unborn branch `master`.
	start_exec.git_run(['branch', '--move', '--force', DEFAULT_BRANCH], root)
}

const initial_commit = { create_repository, commit_all }

export { initial_commit }
