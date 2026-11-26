import { rmSync } from 'node:fs'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { lane_state } from '#scripts/lane/lane-state'
import { run_preflight } from '#scripts/run/run-preflight'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold } from './run-hold'
import { run_hold_cli } from './run-hold-cli'

// joshuafolkken/kit#7494: `run:hold <N> --halfrun-round` re-opens #N's stopped `halfrun` as running,
// returns a `human-review` lane to `running`, and refuses any other record untouched.

const make_directory = temporary_directory('suite')

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))
vi.mock('#scripts/lane/lane-state', () => ({
	lane_state: { read_state: vi.fn(), record_change: vi.fn() },
}))
// joshuafolkken/kit#8829: review-resume asks the work-tree guard first; it would run against the mocked git.
vi.mock('#scripts/lane/lane-transition-guards', () => ({
	lane_transition_guards: { rejection: vi.fn().mockResolvedValue(undefined) },
}))
// joshuafolkken/kit#8932: a refused claim's advice is the subject here, not the check that composes it.
vi.mock('#scripts/run/run-preflight', () => ({
	run_preflight: { CLEAN_VERDICT: 'clean', RECLAIM_VERDICT: 'reclaim', check: vi.fn() },
}))

const scratch = make_directory('run-hold-cli-round-test-')
const WORKTREE = path.join(scratch, '.git')
const TARGET = run_hold.hold_path(WORKTREE)
const ISSUE = '7494'
const OTHER_ISSUE = '7493'
const EXPIRED_AT = new Date(Date.now() - run_hold.HOLD_MAX_AGE_MS * 2)
const RECLAIM_DECISION = {
	advice: 'Stash with -u, switch back, then ask again',
	reason: 'Uncommitted changes are still in the tree',
	verdict: 'reclaim',
} as const
const ROUND_FLAG = '--halfrun-round'
const ROUND_COMMAND = `run:hold ${ROUND_FLAG}`
const out: Array<string> = []

beforeEach(() => {
	out.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		out.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.mocked(git_command.git_directories).mockResolvedValue([WORKTREE, WORKTREE])
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(TARGET, { force: true })
})

describe(ROUND_COMMAND, () => {
	it('names the flag in its usage', () => {
		expect(run_hold_cli.USAGE).toContain(ROUND_FLAG)
	})

	it('re-opens the stop as running and returns a human-review lane to running', async () => {
		run_hold.create_halfrun_stop_hold(TARGET, ISSUE)
		vi.mocked(lane_state.read_state).mockResolvedValue({
			issue: ISSUE,
			state: 'human-review',
			changed_at: '',
			changed_by: '',
		})

		expect(await run_hold_cli.run([ISSUE, ROUND_FLAG])).toBe(0)
		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
		expect(run_hold.read_hold(TARGET)).toMatchObject({ kind: 'held', hold: { issue: ISSUE } })
		expect(lane_state.record_change).toHaveBeenCalledWith({
			issue: ISSUE,
			state: 'running',
			command: ROUND_COMMAND,
		})
	})

	it('answers busy and leaves a running record untouched', async () => {
		run_hold.create_hold(TARGET, ISSUE)

		const before = run_hold.read_hold(TARGET)

		expect(await run_hold_cli.run([ISSUE, ROUND_FLAG])).toBe(1)
		expect(out).toEqual([run_hold_cli.BUSY_VERDICT])
		expect(run_hold.read_hold(TARGET)).toStrictEqual(before)
		expect(lane_state.record_change).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#8932: a round stopped before its `--halfrun-stop` leaves its own record unmarked.
	it('re-opens an interrupted round whose record went stale', async () => {
		run_hold.create_hold(TARGET, ISSUE, { now: EXPIRED_AT })

		expect(await run_hold_cli.run([ISSUE, ROUND_FLAG])).toBe(0)
		expect(run_hold.read_hold(TARGET)).toMatchObject({ kind: 'held', hold: { issue: ISSUE } })
	})
})

// joshuafolkken/kit#8932: the reclaim over an interrupted round of the issue names the round's
// re-claim after the preflight's own advice, which stays for a tree the round does not own.
describe('a refused claim over an interrupted round', () => {
	it.each([
		[ISSUE, [RECLAIM_DECISION.advice, ROUND_FLAG]],
		[OTHER_ISSUE, [RECLAIM_DECISION.advice]],
	])('answers the claim for #%s with %s', async (claimant, expected) => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		run_hold.create_hold(TARGET, ISSUE, { now: EXPIRED_AT })
		vi.mocked(run_preflight.check).mockResolvedValue(RECLAIM_DECISION)

		await run_hold_cli.run([claimant])

		const printed = errors.mock.calls.join('\n')

		expect(out).toEqual([RECLAIM_DECISION.verdict])
		expect(expected.every((part) => printed.includes(part))).toBe(true)
		expect(printed.includes(ROUND_FLAG)).toBe(claimant === ISSUE)
	})
})
