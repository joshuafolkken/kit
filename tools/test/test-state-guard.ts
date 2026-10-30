import { execFileSync } from 'node:child_process'
import { GIT_TIMEOUT_MS } from '#scripts/lib/timeouts'
import type { TestProject } from 'vitest/node'

// Environment variables that git reads from the environment. A test that sets these affects every
// subsequent git command in the same worker when isolation is disabled.
const GIT_ENV_KEYS: ReadonlyArray<string> = [
	'GIT_DIR',
	'GIT_INDEX_FILE',
	'GIT_OBJECT_DIRECTORY',
	'GIT_WORK_TREE',
	'GIT_COMMON_DIR',
]
const SNAPSHOT_FILE = /__snapshots__\/[^/]+\.snap$/u
// The update state `--update` sets; the default `new` writes only snapshots that do not exist yet.
const UPDATE_ALL = 'all'

interface StateSnapshot {
	branch: string
	status: string
	git_env: Record<string, string | undefined>
}

function run_git(args: ReadonlyArray<string>): string {
	try {
		return execFileSync('git', args, {
			encoding: 'utf8',
			stdio: 'pipe',
			timeout: GIT_TIMEOUT_MS,
		}).trim()
	} catch {
		return '(error)'
	}
}

function capture_git_environment(): Record<string, string | undefined> {
	return Object.fromEntries(GIT_ENV_KEYS.map((key) => [key, process.env[key]]))
}

// `vitest --update` rewrites snapshot files by design, so an update run leaves them out of the
// comparison. Any other run, and any other path, still counts.
function tracked_status(status: string, is_snapshot_update: boolean): string {
	if (!is_snapshot_update) return status

	return status
		.split('\n')
		.filter((line) => !SNAPSHOT_FILE.test(line))
		.join('\n')
}

function capture_state(is_snapshot_update = false): StateSnapshot {
	return {
		branch: run_git(['rev-parse', '--abbrev-ref', 'HEAD']),
		status: tracked_status(run_git(['status', '--porcelain']), is_snapshot_update),
		git_env: capture_git_environment(),
	}
}

function environment_diff(
	before: Record<string, string | undefined>,
	after: Record<string, string | undefined>,
): Array<string> {
	return GIT_ENV_KEYS.filter((key) => before[key] !== after[key]).map(
		(key) => `  ${key}: ${String(before[key])} → ${String(after[key])}`,
	)
}

function format_violations(before: StateSnapshot, after: StateSnapshot): string | undefined {
	const lines: Array<string> = []

	if (before.branch !== after.branch) {
		lines.push(`  branch: ${before.branch} → ${after.branch}`)
	}

	if (before.status !== after.status) {
		lines.push('  working tree changed (run "git status" to inspect)')
	}

	lines.push(...environment_diff(before.git_env, after.git_env))

	if (lines.length === 0) return undefined

	return `test-state-guard: tests mutated repository state:\n${lines.join('\n')}`
}

function setup(project: TestProject): () => void {
	const is_snapshot_update = project.config.snapshotOptions.updateSnapshot === UPDATE_ALL
	const before = capture_state(is_snapshot_update)

	return function disarm(): void {
		const after = capture_state(is_snapshot_update)
		const violation = format_violations(before, after)

		if (violation !== undefined) throw new Error(violation)
	}
}

const test_state_guard = {
	GIT_ENV_KEYS,
	capture_state,
	env_diff: environment_diff,
	format_violations,
	tracked_status,
}

export type { StateSnapshot }
export { setup, test_state_guard }
