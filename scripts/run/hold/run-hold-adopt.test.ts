import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { run_label } from '#scripts/run/run-label'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold, type RunHold } from './run-hold'
import { run_hold_adopt } from './run-hold-adopt'
import { run_hold_cli } from './run-hold-cli'

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

// The label calls reach GitHub; `run-label.ts` owns them, so here only which one each command makes.
vi.mock('#scripts/run/run-label', () => ({ run_label: { mark: vi.fn(), unmark: vi.fn() } }))

const scratch = mkdtempSync(path.join(tmpdir(), 'run-hold-adopt-test-'))
const WORKTREE = path.join(scratch, '.git')
const TARGET = run_hold.hold_path(WORKTREE)
const ISSUE = '4156'
const OTHER_ISSUE = '4155'
const ADOPT_FLAG = '--adopt'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

const out: Array<string> = []

function held(): RunHold | undefined {
	const read = run_hold.read_hold(TARGET)

	return read.kind === 'held' ? read.hold : undefined
}

beforeEach(() => {
	out.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		out.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.mocked(git_command.git_directories).mockResolvedValue([WORKTREE, WORKTREE])
})

afterEach(() => {
	vi.clearAllMocks()
	vi.restoreAllMocks()
	rmSync(TARGET, { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('adopting a new run’s unnumbered hold', () => {
	it('re-keys the record in place and applies in-progress', async () => {
		run_hold.create_hold(TARGET, run_hold.UNNUMBERED_ISSUE)
		const taken_at = held()?.taken_at

		expect(await run_hold_cli.run([ADOPT_FLAG, ISSUE])).toBe(SUCCESS_EXIT_CODE)
		expect([held()?.issue, held()?.taken_at]).toStrictEqual([ISSUE, taken_at])
		expect(run_label.mark).toHaveBeenCalledWith(ISSUE)
		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
	})

	it('lets the numbered release then take in-progress back off', async () => {
		run_hold.create_hold(TARGET, run_hold.UNNUMBERED_ISSUE)
		await run_hold_cli.run([ADOPT_FLAG, ISSUE])

		expect(await run_hold_cli.run(['--release', ISSUE])).toBe(SUCCESS_EXIT_CODE)
		expect(held()).toBeUndefined()
		expect(run_label.unmark).toHaveBeenCalledWith(ISSUE)
	})

	it('answers a repeated adopt of the same issue alike', async () => {
		run_hold.create_hold(TARGET, ISSUE)

		expect(await run_hold_cli.run([ADOPT_FLAG, ISSUE])).toBe(SUCCESS_EXIT_CODE)
		expect(run_label.mark).toHaveBeenCalledWith(ISSUE)
	})
})

describe('a hold it may not adopt', () => {
	it('leaves another issue’s record alone and answers busy', async () => {
		run_hold.create_hold(TARGET, OTHER_ISSUE)

		expect(await run_hold_cli.run([ADOPT_FLAG, ISSUE])).toBe(FAILURE_EXIT_CODE)
		expect(held()?.issue).toBe(OTHER_ISSUE)
		expect(run_label.mark).not.toHaveBeenCalled()
		expect(out).toEqual([run_hold_cli.BUSY_VERDICT])
		expect(console.error).toHaveBeenCalledWith(run_hold_adopt.foreign_message(ISSUE))
	})

	it('answers none on a tree that holds no record', async () => {
		expect(await run_hold_cli.run([ADOPT_FLAG, ISSUE])).toBe(FAILURE_EXIT_CODE)
		expect(run_label.mark).not.toHaveBeenCalled()
		expect(out).toEqual([run_hold_cli.NONE_VERDICT])
	})
})
