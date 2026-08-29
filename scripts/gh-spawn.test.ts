import { beforeEach, describe, expect, it, vi } from 'vitest'

const execa_sync_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))

vi.mock('./init/init-paths', () => ({ PROJECT_ROOT: '/fake/root' }))

const REPO_NAME = 'owner/repo'
const TIMEOUT_MS = 3000

const { gh_spawn } = await import('./gh-spawn')

beforeEach(() => {
	execa_sync_mock.mockReset()
})

describe('gh_spawn.get_repo_name_with_owner — success', () => {
	it('returns trimmed stdout when exitCode is 0 and stdout is non-empty', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: `  ${REPO_NAME}\n` })

		expect(gh_spawn.get_repo_name_with_owner()).toBe(REPO_NAME)
	})
})

describe('gh_spawn.get_repo_name_with_owner — failure', () => {
	it('returns undefined when exitCode is non-zero', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 1, stdout: '' })

		expect(gh_spawn.get_repo_name_with_owner()).toBeUndefined()
	})

	it('returns undefined when stdout is empty', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: '' })

		expect(gh_spawn.get_repo_name_with_owner()).toBeUndefined()
	})

	it('returns undefined when stdout is only whitespace', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: ' '.repeat(3) })

		expect(gh_spawn.get_repo_name_with_owner()).toBeUndefined()
	})
})

// joshuafolkken/kit#1023: `gh repo view` goes through GraphQL, which a cloud session is refused
// (403). `init` / `sync` read that as an unresolved repository and skip `sonar-project.properties`,
// so the same fact is read through repository-scoped REST here as it is in `git_gh_repo`.
describe('gh_spawn — what it asks gh for', () => {
	const REST_ARGS = ['api', 'repos/{owner}/{repo}', '--jq', '.full_name']

	it('reads the name through gh api rather than gh repo view', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: REPO_NAME })

		gh_spawn.get_repo_name_with_owner()

		expect(execa_sync_mock).toHaveBeenCalledWith('gh', REST_ARGS, expect.any(Object))
	})

	it('asks the same way when the lookup is bounded by a timeout', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: REPO_NAME })

		gh_spawn.get_repo_name_with_owner_within(TIMEOUT_MS)

		expect(execa_sync_mock).toHaveBeenCalledWith(
			'gh',
			REST_ARGS,
			expect.objectContaining({ timeout: TIMEOUT_MS }),
		)
	})
})
