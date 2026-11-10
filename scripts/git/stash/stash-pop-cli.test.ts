import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_stash } from './git-stash'
import { stash_pop_cli } from './stash-pop-cli'

const MESSAGE = 'backlogrun: parked #2028'
const PARKED = { selector: 'stash@{1}', subject: `On main: ${MESSAGE}` }
const TOP = { selector: 'stash@{0}', subject: 'On main: run:hold reclaimed before #2024' }
const LANE_DIR = '/lanes/2028'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

function verdict(): string {
	return String(vi.mocked(console.info).mock.calls.at(-1)?.[0])
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(git_stash, 'list').mockResolvedValue([])
	vi.spyOn(git_stash, 'pop').mockResolvedValue()
	vi.spyOn(git_stash, 'list_by_hash').mockResolvedValue([])
	vi.spyOn(git_stash, 'position_of').mockResolvedValue(undefined)
})

describe('josh stash:pop targeting', () => {
	it('pops only the matching stash even when another is on top', async () => {
		vi.mocked(git_stash.list).mockResolvedValue([TOP, PARKED])

		const code = await stash_pop_cli.run([MESSAGE])

		expect(vi.mocked(git_stash.pop)).toHaveBeenCalledTimes(1)
		expect(vi.mocked(git_stash.pop)).toHaveBeenCalledWith(PARKED.selector, undefined)
		expect(verdict()).toBe(stash_pop_cli.POPPED_VERDICT)
		expect(code).toBe(SUCCESS_EXIT_CODE)
	})

	it('reads the shared stack and pops into the lane tree named by --dir', async () => {
		vi.mocked(git_stash.list).mockResolvedValue([TOP, PARKED])

		const code = await stash_pop_cli.run([MESSAGE, '--dir', LANE_DIR])

		expect(vi.mocked(git_stash.list)).toHaveBeenCalledWith(LANE_DIR)
		expect(vi.mocked(git_stash.pop)).toHaveBeenCalledWith(PARKED.selector, LANE_DIR)
		expect(code).toBe(SUCCESS_EXIT_CODE)
	})
})

describe('josh stash:pop refusals', () => {
	it('refuses and pops nothing when no stash matches', async () => {
		vi.mocked(git_stash.list).mockResolvedValue([TOP])

		const code = await stash_pop_cli.run([MESSAGE])

		expect(vi.mocked(git_stash.pop)).not.toHaveBeenCalled()
		expect(verdict()).toBe(stash_pop_cli.NO_MATCH_VERDICT)
		expect(code).toBe(FAILURE_EXIT_CODE)
	})

	it('refuses when more than one stash matches', async () => {
		const duplicate = { selector: 'stash@{2}', subject: MESSAGE }

		vi.mocked(git_stash.list).mockResolvedValue([PARKED, duplicate])

		const code = await stash_pop_cli.run([MESSAGE])

		expect(vi.mocked(git_stash.pop)).not.toHaveBeenCalled()
		expect(verdict()).toBe(stash_pop_cli.AMBIGUOUS_VERDICT)
		expect(code).toBe(FAILURE_EXIT_CODE)
	})

	it('refuses a call with no message', async () => {
		const code = await stash_pop_cli.run([])

		expect(vi.mocked(git_stash.pop)).not.toHaveBeenCalled()
		expect(code).toBe(FAILURE_EXIT_CODE)
	})

	it('refuses an unknown flag rather than popping around it', async () => {
		const code = await stash_pop_cli.run([MESSAGE, '--nope'])

		expect(vi.mocked(git_stash.pop)).not.toHaveBeenCalled()
		expect(code).toBe(FAILURE_EXIT_CODE)
	})
})

// joshuafolkken/kit#6979: two withdraws pushed one lane's work under one message, and the ambiguous
// refusal left no way to the entry that held the work.
describe('josh stash:pop — one message, several entries', () => {
	const WORK = { selector: 'aaaa1111bbbb2222', subject: `On 6683-lane: ${MESSAGE}` }
	const DELETIONS = { selector: 'cccc3333dddd4444', subject: `On 6683-lane: ${MESSAGE}` }

	it('names each matching entry by its hash when refusing', async () => {
		vi.mocked(git_stash.list).mockResolvedValue([PARKED, { ...PARKED, selector: 'stash@{2}' }])
		vi.mocked(git_stash.list_by_hash).mockResolvedValue([DELETIONS, WORK])

		const code = await stash_pop_cli.run([MESSAGE])

		expect(verdict()).toBe(stash_pop_cli.AMBIGUOUS_VERDICT)
		expect(vi.mocked(console.error)).toHaveBeenCalledWith(
			expect.stringContaining(`${DELETIONS.selector}, ${WORK.selector}`),
		)
		expect(code).toBe(FAILURE_EXIT_CODE)
	})

	it('pops the entry a hash prefix names, at the position read before the pop', async () => {
		vi.mocked(git_stash.list_by_hash).mockResolvedValue([DELETIONS, WORK])
		vi.mocked(git_stash.position_of).mockResolvedValue('stash@{1}')

		const code = await stash_pop_cli.run(['aaaa1111', '--dir', LANE_DIR])

		expect(vi.mocked(git_stash.position_of)).toHaveBeenCalledWith(WORK.selector, LANE_DIR)
		expect(vi.mocked(git_stash.pop)).toHaveBeenCalledWith('stash@{1}', LANE_DIR)
		expect(verdict()).toBe(stash_pop_cli.POPPED_VERDICT)
		expect(code).toBe(SUCCESS_EXIT_CODE)
	})

	it('refuses a hash no entry carries', async () => {
		vi.mocked(git_stash.list_by_hash).mockResolvedValue([DELETIONS, WORK])

		const code = await stash_pop_cli.run(['eeee5555'])

		expect(vi.mocked(git_stash.pop)).not.toHaveBeenCalled()
		expect(verdict()).toBe(stash_pop_cli.NO_MATCH_VERDICT)
		expect(code).toBe(FAILURE_EXIT_CODE)
	})
})

describe('josh stash:pop conflicts', () => {
	it('reports conflicted at exit 0 when the pop applies with conflicts', async () => {
		vi.mocked(git_stash.list).mockResolvedValue([TOP, PARKED])
		vi.mocked(git_stash.pop).mockRejectedValue(new Error('CONFLICT'))
		vi.spyOn(git_stash, 'has_conflict').mockResolvedValue(true)

		const code = await stash_pop_cli.run([MESSAGE])

		expect(vi.mocked(git_stash.pop)).toHaveBeenCalledWith(PARKED.selector, undefined)
		expect(verdict()).toBe(stash_pop_cli.CONFLICTED_VERDICT)
		expect(code).toBe(SUCCESS_EXIT_CODE)
	})

	it('fails when the pop errors without leaving conflicts', async () => {
		vi.mocked(git_stash.list).mockResolvedValue([TOP, PARKED])
		vi.mocked(git_stash.pop).mockRejectedValue(new Error('fatal: bad revision'))
		vi.spyOn(git_stash, 'has_conflict').mockResolvedValue(false)

		const code = await stash_pop_cli.run([MESSAGE])

		expect(code).toBe(FAILURE_EXIT_CODE)
	})
})
