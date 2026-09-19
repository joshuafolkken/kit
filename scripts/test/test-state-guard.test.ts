import { describe, expect, it } from 'vitest'
import { test_state_guard, type StateSnapshot } from './test-state-guard'

const EMPTY_GIT_ENV: Record<string, string | undefined> = Object.fromEntries(
	test_state_guard.GIT_ENV_KEYS.map((key: string): [string, undefined] => [key, undefined]),
)

function make_snapshot(
	branch: string,
	status: string,
	git_environment: Record<string, string | undefined> = EMPTY_GIT_ENV,
): StateSnapshot {
	return { branch, status, git_env: git_environment }
}

describe('test_state_guard.format_violations', () => {
	it('returns undefined when state is unchanged', () => {
		const snap = make_snapshot('main', '')

		expect(test_state_guard.format_violations(snap, snap)).toBeUndefined()
	})

	it('reports branch change', () => {
		const before = make_snapshot('main', '')
		const after = make_snapshot('feature', '')

		expect(test_state_guard.format_violations(before, after)).toContain('branch: main → feature')
	})

	it('reports working tree change', () => {
		const before = make_snapshot('main', '')
		const after = make_snapshot('main', 'M src/file.ts')

		expect(test_state_guard.format_violations(before, after)).toContain('working tree changed')
	})

	it('reports git environment variable change', () => {
		const before = make_snapshot('main', '')
		const after = make_snapshot('main', '', { ...EMPTY_GIT_ENV, GIT_DIR: '/fake/git-dir' })

		expect(test_state_guard.format_violations(before, after)).toContain('GIT_DIR')
	})
})

describe('test_state_guard.env_diff', () => {
	it('returns empty array when env is unchanged', () => {
		expect(test_state_guard.env_diff(EMPTY_GIT_ENV, EMPTY_GIT_ENV)).toEqual([])
	})

	it('detects a single changed key', () => {
		const changed = { ...EMPTY_GIT_ENV, GIT_DIR: '/some/path' }
		const result = test_state_guard.env_diff(EMPTY_GIT_ENV, changed)

		expect(result).toHaveLength(1)
		expect(result[0]).toContain('GIT_DIR')
	})

	it('detects multiple changed keys', () => {
		const changed = { ...EMPTY_GIT_ENV, GIT_DIR: '/a', GIT_WORK_TREE: '/b' }

		expect(test_state_guard.env_diff(EMPTY_GIT_ENV, changed)).toHaveLength(2)
	})
})
