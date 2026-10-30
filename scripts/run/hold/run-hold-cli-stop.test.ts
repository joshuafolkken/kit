import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { lane_state } from '#scripts/lane/lane-state'
import { test_e2e_stamp } from '#scripts/test/test-e2e-stamp'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold } from './run-hold'
import { run_hold_cli } from './run-hold-cli'
import { run_stop_notify } from './run-stop-notify'

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), head_commit: vi.fn(), status: vi.fn() },
}))
vi.mock('#scripts/lane/lane-state', () => ({ lane_state: { record_change: vi.fn() } }))

// The send itself is `run-stop-notify.test.ts`'s; here only which one a marked stop calls.
vi.mock('./run-stop-notify', () => ({
	run_stop_notify: { send_halfrun: vi.fn(), send_human_review: vi.fn(), send_prrun: vi.fn() },
}))

// The record's own reading is `test-e2e-stamp.test.ts`'s; here only what the stop does with its answer.
vi.mock('#scripts/test/test-e2e-stamp', () => ({
	test_e2e_stamp: { is_current_tree: vi.fn() },
}))

const scratch = mkdtempSync(path.join(tmpdir(), 'run-hold-cli-stop-test-'))
const WORKTREE = path.join(scratch, '.git')
const TARGET = run_hold.hold_path(WORKTREE)
const ISSUE = '4135'
const OTHER_ISSUE = '4134'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const HALFRUN_STOP_FLAG = '--halfrun-stop'
const HUMAN_REVIEW_STOP_FLAG = '--human-review-stop'
const PRRUN_STOP_FLAG = '--prrun-stop'
const E2E_OWED_VERDICT = 'e2e-owed'

const out: Array<string> = []

function held_record(): ReturnType<typeof run_hold.read_hold> {
	return run_hold.read_hold(TARGET)
}

beforeEach(() => {
	out.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		out.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.mocked(git_command.git_directories).mockResolvedValue([WORKTREE, WORKTREE])
	vi.mocked(git_command.head_commit).mockResolvedValue('abc1234')
	vi.mocked(test_e2e_stamp.is_current_tree).mockResolvedValue(true)
})

afterEach(() => {
	vi.clearAllMocks()
	vi.restoreAllMocks()
	rmSync(TARGET, { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('a marked stop sends its own confirmation', () => {
	it('sends the halfrun confirmation and still answers the single hold token', async () => {
		run_hold.create_hold(TARGET, ISSUE)

		expect(await run_hold_cli.run([ISSUE, HALFRUN_STOP_FLAG])).toBe(SUCCESS_EXIT_CODE)
		expect(run_stop_notify.send_halfrun).toHaveBeenCalledWith(TARGET, ISSUE)
		expect(run_stop_notify.send_prrun).not.toHaveBeenCalled()
		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
		expect(lane_state.record_change).not.toHaveBeenCalled()
	})

	it('sends the prrun confirmation on a prrun stop', async () => {
		run_hold.create_hold(TARGET, ISSUE)

		expect(await run_hold_cli.run([ISSUE, PRRUN_STOP_FLAG])).toBe(SUCCESS_EXIT_CODE)
		expect(run_stop_notify.send_prrun).toHaveBeenCalledWith(TARGET, ISSUE)
		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
	})

	it('sends nothing when the record is another run’s', async () => {
		run_hold.create_hold(TARGET, OTHER_ISSUE)

		await run_hold_cli.run([ISSUE, HALFRUN_STOP_FLAG])

		expect(run_stop_notify.send_halfrun).not.toHaveBeenCalled()
		expect(out).toEqual([run_hold_cli.BUSY_VERDICT])
	})
})

describe('a needs-human-review stop', () => {
	it('keeps the hold marked as a halfrun stop and sends its own confirmation', async () => {
		run_hold.create_hold(TARGET, ISSUE)

		expect(await run_hold_cli.run([ISSUE, HUMAN_REVIEW_STOP_FLAG])).toBe(SUCCESS_EXIT_CODE)

		const read = held_record()

		expect(read.kind === 'held' ? read.hold.is_halfrun_stop : undefined).toBe(true)
		expect(run_stop_notify.send_human_review).toHaveBeenCalledWith(TARGET, ISSUE)
		expect(lane_state.record_change).toHaveBeenCalledExactlyOnceWith({
			issue: ISSUE,
			state: 'human-review',
			command: 'run:hold --human-review-stop',
		})
		expect(run_stop_notify.send_halfrun).not.toHaveBeenCalled()
		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
	})
})

describe('a stop before commit on a tree test:e2e has not answered green on', () => {
	it.each([[HALFRUN_STOP_FLAG], [HUMAN_REVIEW_STOP_FLAG]])(
		'refuses %s, marks nothing and sends nothing',
		async (flag) => {
			vi.mocked(test_e2e_stamp.is_current_tree).mockResolvedValue(false)
			run_hold.create_hold(TARGET, ISSUE)

			expect(await run_hold_cli.run([ISSUE, flag])).toBe(FAILURE_EXIT_CODE)

			const read = held_record()

			expect(read.kind === 'held' ? read.hold.is_halfrun_stop : 'gone').toBeUndefined()
			expect(run_stop_notify.send_halfrun).not.toHaveBeenCalled()
			expect(run_stop_notify.send_human_review).not.toHaveBeenCalled()
			expect(lane_state.record_change).not.toHaveBeenCalled()
			expect(out).toEqual([E2E_OWED_VERDICT])
		},
	)

	it('does not ask a prrun stop, which has CI behind its pull request', async () => {
		vi.mocked(test_e2e_stamp.is_current_tree).mockResolvedValue(false)
		run_hold.create_hold(TARGET, ISSUE)

		expect(await run_hold_cli.run([ISSUE, PRRUN_STOP_FLAG])).toBe(SUCCESS_EXIT_CODE)
		expect(test_e2e_stamp.is_current_tree).not.toHaveBeenCalled()
	})
})
