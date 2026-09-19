import { execSync } from 'node:child_process'

// Environment variables that git reads from the environment. A test that sets these affects every
// subsequent git command in the same worker when isolation is disabled.
const GIT_ENV_KEYS: ReadonlyArray<string> = [
	'GIT_DIR',
	'GIT_INDEX_FILE',
	'GIT_OBJECT_DIRECTORY',
	'GIT_WORK_TREE',
	'GIT_COMMON_DIR',
]

interface StateSnapshot {
	branch: string
	status: string
	git_env: Record<string, string | undefined>
}

function run_git(args: string): string {
	try {
		return execSync(`git ${args}`, { encoding: 'utf8', stdio: 'pipe' }).trim()
	} catch {
		return '(error)'
	}
}

function capture_git_environment(): Record<string, string | undefined> {
	return Object.fromEntries(GIT_ENV_KEYS.map((key) => [key, process.env[key]]))
}

function capture_state(): StateSnapshot {
	return {
		branch: run_git('rev-parse --abbrev-ref HEAD'),
		status: run_git('status --porcelain'),
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

function setup(): () => void {
	const before = capture_state()

	return function disarm(): void {
		const after = capture_state()
		const violation = format_violations(before, after)

		if (violation !== undefined) throw new Error(violation)
	}
}

const test_state_guard = {
	GIT_ENV_KEYS,
	capture_state,
	env_diff: environment_diff,
	format_violations,
}

export type { StateSnapshot }
export { setup, test_state_guard }
