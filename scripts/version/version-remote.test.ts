import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetch_latest_version } from './version-remote'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

interface FakeResult {
	stdout?: string
	stderr?: string
	exitCode?: number
	shortMessage?: string
}

function fake_result(overrides: FakeResult): ExecaSyncResult {
	const result = { stdout: '', stderr: '', exitCode: 0, ...overrides }

	return result as unknown as ExecaSyncResult
}

function fake_stdout(stdout: string): ExecaSyncResult {
	return fake_result({ stdout })
}

function expect_gh_call(endpoint: string): void {
	expect(mocked_execa_sync).toHaveBeenCalledWith('gh', ['api', endpoint, '--jq', '.[0].name'], {
		reject: false,
	})
}

beforeEach(() => {
	vi.clearAllMocks()
})

const KIT_ENDPOINT = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'
const KIT_PACKAGE = '@joshuafolkken/kit'
const GAME_PACKAGE = '@joshuafolkken/game-kit'
const BLANK_SPACES = 3

describe('fetch_latest_version returns', () => {
	it('returns the trimmed version from gh api stdout', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('0.223.0\n'))

		expect(fetch_latest_version(KIT_ENDPOINT, KIT_PACKAGE)).toBe('0.223.0')
	})

	it('queries the supplied versions endpoint via gh api', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout('0.223.0'))

		fetch_latest_version(KIT_ENDPOINT, KIT_PACKAGE)

		expect_gh_call(KIT_ENDPOINT)
	})

	it('queries a different package endpoint when configured for another package', () => {
		const other_endpoint = '/users/joshuafolkken/packages/npm/game-kit/versions?per_page=1'

		mocked_execa_sync.mockReturnValue(fake_stdout('1.0.0'))

		fetch_latest_version(other_endpoint, GAME_PACKAGE)

		expect_gh_call(other_endpoint)
	})
})

describe('fetch_latest_version guards', () => {
	it('throws an actionable error naming the package when the endpoint is undefined', () => {
		expect(() => fetch_latest_version(undefined, KIT_PACKAGE)).toThrow(
			/Could not derive a versions endpoint for @joshuafolkken\/kit/u,
		)
		expect(mocked_execa_sync).not.toHaveBeenCalled()
	})

	it('throws an actionable error naming the package when the endpoint is empty', () => {
		expect(() => fetch_latest_version(' '.repeat(BLANK_SPACES), GAME_PACKAGE)).toThrow(
			/Could not derive a versions endpoint for @joshuafolkken\/game-kit/u,
		)
		expect(mocked_execa_sync).not.toHaveBeenCalled()
	})
})

describe('fetch_latest_version wraps failures', () => {
	it('wraps a gh api failure into a concise message instead of a raw ExecaSyncError', () => {
		mocked_execa_sync.mockReturnValue(
			fake_result({ exitCode: 1, stderr: 'gh: Not Found (HTTP 404)' }),
		)

		expect(() => fetch_latest_version(KIT_ENDPOINT, KIT_PACKAGE)).toThrow(
			`Failed to fetch latest version for ${KIT_PACKAGE} via ${KIT_ENDPOINT}: gh: Not Found (HTTP 404)`,
		)
	})

	it('falls back to the execa short message when the failure has no stderr', () => {
		mocked_execa_sync.mockReturnValue(
			fake_result({ exitCode: 1, stderr: '', shortMessage: 'Command failed with exit code 1' }),
		)

		expect(() => fetch_latest_version(KIT_ENDPOINT, KIT_PACKAGE)).toThrow(
			/Command failed with exit code 1/u,
		)
	})
})
