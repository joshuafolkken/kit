import { git_command } from '#scripts/git/git-command'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn() },
}))

// joshuafolkken/kit#3589: the catch around the whole answer reported every failure as an unreadable
// git directory and dropped the failure itself, so a wrong `unknown` could not be followed back.

const git_directories = vi.mocked(git_command.git_directories)
const WORKTREE = '/scratch/worktree.git'
const REPOSITORY = '/scratch/repository.git'
const REASON = 'EACCES: permission denied'
const FAILURE_EXIT_CODE = 1

const out: Array<string> = []
const errors: Array<string> = []

beforeEach(() => {
	out.length = 0
	errors.length = 0
	vi.spyOn(console, 'info').mockImplementation((text: string) => {
		out.push(text)
	})
	vi.spyOn(console, 'error').mockImplementation((text: string) => {
		errors.push(text)
	})
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('an unknown answer says why', () => {
	it('keeps the git directory message for a directory that cannot be resolved', async () => {
		git_directories.mockRejectedValue(new Error(REASON))

		expect(await run_carry_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(out).toStrictEqual([run_carry_cli.UNKNOWN_VERDICT])
		expect(errors).toStrictEqual([run_carry.unknown_message()])
	})

	it('reports the failure itself when acting on the record throws', async () => {
		vi.spyOn(run_carry, 'read_carry').mockImplementation(() => {
			throw new Error(REASON)
		})

		expect(await run_carry_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(out).toStrictEqual([run_carry_cli.UNKNOWN_VERDICT])
		expect(errors).toStrictEqual([`run:carry failed and established nothing: ${REASON}`])
	})
})
