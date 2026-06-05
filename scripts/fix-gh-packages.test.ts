import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get_gh_cli_token } from './fix-gh-packages'

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

describe('get_gh_cli_token', () => {
	it('returns the trimmed token from gh auth token', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('ghp_abc123\n'))

		expect(get_gh_cli_token()).toBe('ghp_abc123')
	})

	it('returns undefined when the token output is empty', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('  \n'))

		expect(get_gh_cli_token()).toBeUndefined()
	})

	it('returns undefined when gh auth token throws (not authenticated)', () => {
		mocked_execa_sync.mockImplementation(() => {
			throw new Error('not logged in')
		})

		expect(get_gh_cli_token()).toBeUndefined()
	})
})
