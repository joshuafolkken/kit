import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { version_update } from './version-update'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

function fake_sync_result(exit_code: number | undefined): ExecaSyncResult {
	const result = { exitCode: exit_code }

	return result as unknown as ExecaSyncResult
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('version_update.run_upgrade', () => {
	it('runs the command through sh -c and returns its exit code', () => {
		const upgrade_command = 'npm i -g pkg'

		mocked_execa_sync.mockReturnValue(fake_sync_result(0))

		expect(version_update.run_upgrade(upgrade_command)).toBe(0)
		expect(mocked_execa_sync).toHaveBeenCalledWith('sh', ['-c', upgrade_command], {
			stdio: 'inherit',
			reject: false,
		})
	})

	it('falls back to the failure code when exitCode is undefined', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))

		expect(version_update.run_upgrade('cmd')).toBe(1)
	})
})

describe('version_update.run_all_upgrades', () => {
	it('returns 0 and runs no command for an empty list', () => {
		expect(version_update.run_all_upgrades([])).toBe(0)
		expect(mocked_execa_sync).not.toHaveBeenCalled()
	})

	it('runs every command and returns 0 when all succeed', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))

		expect(version_update.run_all_upgrades(['a', 'b'])).toBe(0)
		expect(mocked_execa_sync).toHaveBeenCalledTimes(2)
	})

	it('surfaces a non-zero exit code while still running every command', () => {
		mocked_execa_sync
			.mockReturnValueOnce(fake_sync_result(3))
			.mockReturnValueOnce(fake_sync_result(0))

		expect(version_update.run_all_upgrades(['a', 'b'])).toBe(3)
		expect(mocked_execa_sync).toHaveBeenCalledTimes(2)
	})
})
