import { git_followup_pending } from '#scripts/followup/git-followup-pending'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { release_request, type ReleaseRequestLines } from './release-request'
import { release_scope_cli } from './release-scope-cli'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

const REQUEST: ReleaseRequestLines = {
	release_issue: '[#4321](url)',
	request: 'request: release it',
}

function given_pending(pending: number | undefined): void {
	vi.spyOn(git_followup_pending, 'read_pending').mockResolvedValue(pending)
}

function given_request(): MockInstance<typeof release_request.read> {
	return vi.spyOn(release_request, 'read').mockResolvedValue(REQUEST)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('release_scope_cli.decide', () => {
	it('reports unknown when the count could not be read', () => {
		expect(release_scope_cli.decide(undefined)).toEqual({
			scope: release_scope_cli.UNKNOWN_SCOPE,
			reason: release_scope_cli.UNKNOWN_REASON,
		})
	})

	it('skips when main has taken no merge since the version last changed', () => {
		const decision = release_scope_cli.decide(0)

		expect(decision.scope).toBe(release_scope_cli.SKIPPED_SCOPE)
		expect(decision.reason).toContain(release_scope_cli.NOTHING_PENDING_REASON)
	})

	it.each([1, 53])('requires a release when %i merge(s) are unreleased', (pending) => {
		const decision = release_scope_cli.decide(pending)

		expect(decision.scope).toBe(release_scope_cli.REQUIRED_SCOPE)
		expect(decision.reason).toContain(String(pending))
		expect(decision.reason).toContain(release_scope_cli.RELEASE_HINT)
	})
})

describe('release_scope_cli.run reports the verdict', () => {
	it('puts the verdict alone on stdout and the reason on stderr', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		given_pending(2)
		given_request()

		await expect(release_scope_cli.run([])).resolves.toBe(SUCCESS_EXIT_CODE)
		expect(info).toHaveBeenCalledOnce()
		expect(info).toHaveBeenCalledWith(release_scope_cli.REQUIRED_SCOPE)
		expect(error).toHaveBeenCalledWith(expect.stringContaining(release_scope_cli.RELEASE_HINT))
	})
})

describe('release_scope_cli.run cites the open release Issue', () => {
	it('prints the release Issue and the request line on required', async () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		given_pending(1)
		given_request()

		await release_scope_cli.run([])
		expect(error).toHaveBeenCalledWith(`release_issue: ${REQUEST.release_issue}`)
		expect(error).toHaveBeenCalledWith(REQUEST.request)
	})

	it('carries the release Issue and the request in the --json object on required', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		given_pending(1)
		given_request()

		await release_scope_cli.run(['--json'])
		expect(info).toHaveBeenCalledWith(expect.stringContaining('"release_issue":"[#4321](url)"'))
		expect(info).toHaveBeenCalledWith(expect.stringContaining('"request":"request: release it"'))
	})

	it.each([0, undefined])('looks no release Issue up when the count is %s', async (pending) => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const read = given_request()

		given_pending(pending)

		await release_scope_cli.run([])
		expect(read).not.toHaveBeenCalled()
	})
})

describe('release_scope_cli.run never hides an unreadable count', () => {
	it('never reads an unreadable count as skip', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		given_pending(undefined)

		await expect(release_scope_cli.run([])).resolves.toBe(SUCCESS_EXIT_CODE)
		expect(info).toHaveBeenCalledWith(release_scope_cli.UNKNOWN_SCOPE)
		expect(info).not.toHaveBeenCalledWith(release_scope_cli.SKIPPED_SCOPE)
	})
})

describe('release_scope_cli.run handles flags and the exit code', () => {
	it('emits one JSON object under the scope key with --json', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const expected = `"${release_scope_cli.JSON_KEY}":"${release_scope_cli.SKIPPED_SCOPE}"`

		given_pending(0)

		await expect(release_scope_cli.run(['--json'])).resolves.toBe(SUCCESS_EXIT_CODE)
		expect(info).toHaveBeenCalledWith(expect.stringContaining(expected))
		expect(error).not.toHaveBeenCalled()
	})

	it('refuses an unknown flag with the usage line, reading nothing', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const read = vi.spyOn(git_followup_pending, 'read_pending')

		await expect(release_scope_cli.run(['--staged'])).resolves.toBe(FAILURE_EXIT_CODE)
		expect(error).toHaveBeenCalledWith(release_scope_cli.USAGE)
		expect(read).not.toHaveBeenCalled()
	})
})
