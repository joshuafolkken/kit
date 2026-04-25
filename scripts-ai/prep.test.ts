import { describe, expect, it, vi } from 'vitest'
import type { OverridesDiff } from '../scripts/overrides/overrides-logic'

const { checkout_mock, pull_mock } = vi.hoisted(() => ({
	checkout_mock: vi.fn().mockResolvedValue({}),
	pull_mock: vi.fn().mockResolvedValue({}),
}))

vi.mock('../scripts/git/git-command', () => ({
	git_command: { checkout: checkout_mock, pull: pull_mock },
}))

vi.mock('node:child_process', () => ({
	execSync: vi.fn(),
}))

const write_file_spy = vi.hoisted(() => vi.fn())

vi.mock('node:fs', () => ({
	readFileSync: vi.fn().mockReturnValue('{"name":"kit","pnpm":{"overrides":{}}}'),
	writeFileSync: write_file_spy,
}))

const { prep } = await import('./prep')

function check_diff_log(diff: OverridesDiff, expected_substring: string): void {
	const spy = vi.spyOn(console, 'error').mockImplementation(() => {
		/* suppress */
	})

	prep.report_diff(diff)

	expect(spy).toHaveBeenCalledWith(expect.stringContaining(expected_substring))
	vi.restoreAllMocks()
}

const EMPTY_ENTRIES = { removed: [], modified: [], added: [] }

describe('report_diff — header', () => {
	it('always logs the change header', () => {
		check_diff_log({ is_changed: true, ...EMPTY_ENTRIES }, 'pnpm.overrides was modified')
	})
})

describe('report_diff — entry types', () => {
	it('logs removed entry with key and previous value', () => {
		check_diff_log(
			{ is_changed: true, removed: [{ key: 'pkg', value: '^1.0.0' }], modified: [], added: [] },
			'removed: pkg (was ^1.0.0)',
		)
	})

	it('logs modified entry with old and new values', () => {
		check_diff_log(
			{
				is_changed: true,
				removed: [],
				modified: [{ key: 'pkg', old_value: '^1.0.0', new_value: '^2.0.0' }],
				added: [],
			},
			'changed: pkg: ^1.0.0 → ^2.0.0',
		)
	})

	it('logs added entry with key and new value', () => {
		check_diff_log(
			{ is_changed: true, removed: [], modified: [], added: [{ key: 'pkg', value: '^3.0.0' }] },
			'added:   pkg → ^3.0.0',
		)
	})
})

describe('report_diff — call count', () => {
	it('logs one line per entry across all change types', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {
			/* suppress */
		})

		prep.report_diff({
			is_changed: true,
			removed: [{ key: 'a', value: '1' }],
			modified: [{ key: 'b', old_value: '1', new_value: '2' }],
			added: [{ key: 'c', value: '3' }],
		})

		expect(spy).toHaveBeenCalledTimes(4)
		vi.restoreAllMocks()
	})
})

describe('prepare_repository — git operations', () => {
	it('checks out main branch via git_command', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})
		await prep.prepare_repository()

		expect(checkout_mock).toHaveBeenCalledWith('main')
		vi.restoreAllMocks()
	})

	it('pulls latest changes via git_command', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})
		await prep.prepare_repository()

		expect(pull_mock).toHaveBeenCalled()
		vi.restoreAllMocks()
	})
})

describe('restore_overrides — schema-validated write', () => {
	it('writes JSON containing the provided snapshot overrides', () => {
		const snapshot = { react: '^18.0.0' }

		prep.restore_overrides(snapshot)

		const written = JSON.parse(write_file_spy.mock.calls.at(-1)?.[1] as string) as {
			pnpm?: { overrides?: Record<string, string> }
		}

		expect(written.pnpm?.overrides).toEqual(snapshot)
	})

	it('preserves top-level package.json fields outside pnpm', () => {
		prep.restore_overrides({})

		const written = JSON.parse(write_file_spy.mock.calls.at(-1)?.[1] as string) as {
			name?: string
		}

		expect(written.name).toBe('kit')
	})
})
