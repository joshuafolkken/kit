import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetch_latest_version } from './version-remote'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

function fake_stdout(stdout: string): ExecaSyncResult {
	const result = { stdout }

	return result as unknown as ExecaSyncResult
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('fetch_latest_version', () => {
	it('returns the trimmed version from gh api stdout', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('0.223.0\n'))

		expect(fetch_latest_version()).toBe('0.223.0')
	})

	it('queries the kit package versions endpoint via gh api', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('0.223.0'))

		fetch_latest_version()

		expect(mocked_execa_sync).toHaveBeenCalledWith('gh', [
			'api',
			expect.stringContaining('kit/versions'),
			'--jq',
			'.[0].name',
		])
	})
})
