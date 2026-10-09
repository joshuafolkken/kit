import { existsSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { initial_commit } from '#scripts/init/initial-commit'
import { start_exec } from '#scripts/init/start-exec'

// `josh dogfood:commit <dir>` makes the first commit of a test project a dogfood run created itself.
// An agent's own `git add` / `git commit` is refused wherever it points,
// because the index guard cannot tell a throwaway project from the user's work; this command is the
// one sanctioned route, and it accepts only a directory that cannot be anyone's work: named
// `kit-test-*`, outside the kit checkout, and with no commit yet — a `.git` without history, as
// `sv create` leaves, still qualifies, while a repository with history or inside another one never does.

const TEST_PROJECT_PREFIX = 'kit-test-'

function test_project_root(target: string): string {
	return realpathSync(target)
}

function is_within(parent: string, child: string): boolean {
	const relative = path.relative(parent, child)

	return !relative.startsWith('..') && !path.isAbsolute(relative)
}

function name_refusal(target: string): string | undefined {
	if (path.basename(target).startsWith(TEST_PROJECT_PREFIX)) return undefined

	return `the directory name does not start with ${TEST_PROJECT_PREFIX}`
}

function directory_refusal(target: string): string | undefined {
	if (existsSync(target) && statSync(target).isDirectory()) return undefined

	return 'the directory does not exist'
}

// A test project inside the kit checkout would be committed into kit itself when it has no `.git` of
// its own, so the checkout and everything under it is refused before git is asked anything.
function checkout_refusal(root: string, kit_root: string): string | undefined {
	return is_within(realpathSync(kit_root), root)
		? 'the directory is inside the kit checkout'
		: undefined
}

function history_refusal(root: string): string | undefined {
	const top_level = start_exec.git_read(['rev-parse', '--show-toplevel'], root)

	if (top_level === undefined) return undefined
	if (realpathSync(top_level) !== root) return 'the directory is inside another git repository'

	const has_commits = start_exec.git_succeeds(['rev-parse', '--verify', '--quiet', 'HEAD'], root)

	return has_commits ? 'the repository already has commits' : undefined
}

// The name is read from the resolved directory, not the path given, so a `kit-test-*` symlink cannot
// carry the commit into a directory of any other name.
function refusal(target: string, kit_root: string): string | undefined {
	const missing = directory_refusal(target)

	if (missing !== undefined) return missing

	const root = test_project_root(target)

	return name_refusal(root) ?? checkout_refusal(root, kit_root) ?? history_refusal(root)
}

function commit(target: string): void {
	const root = test_project_root(target)
	const is_repository = existsSync(path.join(root, '.git'))

	if (!is_repository) initial_commit.create_repository(root)
	initial_commit.commit_all(root)
}

const dogfood_commit = { refusal, commit }

export { dogfood_commit }
