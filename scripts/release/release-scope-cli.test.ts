import { git_followup_pending } from '#scripts/git/git-followup-pending'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { release_scope_cli } from './release-scope-cli'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

function silence_output(): void {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

function given_pending(pending: number | undefined): void {
	vi.spyOn(git_followup_pending, 'read_pending').mockResolvedValue(pending)
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

		await expect(release_scope_cli.run([])).resolves.toBe(SUCCESS_EXIT_CODE)
		expect(info).toHaveBeenCalledWith(release_scope_cli.REQUIRED_SCOPE)
		expect(error).toHaveBeenCalledWith(expect.stringContaining(release_scope_cli.RELEASE_HINT))
	})

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

	it('sets the exit code from run', async () => {
		silence_output()
		given_pending(0)

		await release_scope_cli.main([])

		expect(process.exitCode).toBe(SUCCESS_EXIT_CODE)
	})
})
