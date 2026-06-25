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

const KIT_ENDPOINT = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'

describe('fetch_latest_version', () => {
	it('returns the trimmed version from gh api stdout', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('0.223.0\n'))

		expect(fetch_latest_version(KIT_ENDPOINT)).toBe('0.223.0')
	})

	it('queries the supplied versions endpoint via gh api', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('0.223.0'))

		fetch_latest_version(KIT_ENDPOINT)

		expect(mocked_execa_sync).toHaveBeenCalledWith('gh', ['api', KIT_ENDPOINT, '--jq', '.[0].name'])
	})

	it('queries a different package endpoint when configured for another package', () => {
		const other_endpoint = '/users/joshuafolkken/packages/npm/game-kit/versions?per_page=1'

		mocked_execa_sync.mockReturnValue(fake_stdout('1.0.0'))

		fetch_latest_version(other_endpoint)

		expect(mocked_execa_sync).toHaveBeenCalledWith('gh', [
			'api',
			other_endpoint,
			'--jq',
			'.[0].name',
		])
	})
})
