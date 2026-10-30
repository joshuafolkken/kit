import { git_command } from '#scripts/git/git-command'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { review_stamps } from '#scripts/review/review-stamps'
import { run_ship_planned, type Unplanned } from '#scripts/run/ship/run-ship-planned'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATE_GREEN, GATE_MOVED, run_review } from './run-review'
import { run_review_cli } from './run-review-cli'
import { run_review_pinned } from './run-review-pinned'
import { run_review_pinned_accepted } from './run-review-pinned-accepted'
import { run_review_pinned_join } from './run-review-pinned-join'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#4774: a gate that passed before a review fix moved the tree is not reported red —
// neither the `Gate RED` note nor the gate's log, and its timing ends at its own green stamp.

const GATE_TAKEN_AT = '2026-09-23T10:40:07.855Z'
const GATE_LOG = '✔ verification gate passed (8 checks)'

beforeEach(() => {
	vi.spyOn(run_review_pinned_steps, 'wait_for_answer').mockResolvedValue(undefined)
	vi.spyOn(run_review_pinned_steps, 'launched_reason').mockReturnValue(undefined)
	// No launch, so the join never reads this checkout's own record nor starts a real check.
	vi.spyOn(run_review_pinned_steps, 'launched_tree').mockReturnValue(undefined)
	vi.spyOn(run_review_steps, 'wait_for_gate_finish').mockResolvedValue(GATE_MOVED)
	vi.spyOn(run_review_steps, 'read_gate_log').mockReturnValue(GATE_LOG)
	vi.spyOn(run_review_steps, 'complete_timing').mockReturnValue(undefined)
	vi.spyOn(review_stamps.gate_stamp, 'read').mockReturnValue({ taken_at: GATE_TAKEN_AT, files: {} })
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	// No git directory, so no accepted reason is recorded or read (`run-review-pinned-accepted.ts`).
	vi.spyOn(git_command, 'git_directories').mockResolvedValue([])
})

// No unplanned file, so the join neither prints the notice nor writes its record (joshuafolkken/kit#5388).
beforeEach(() => {
	vi.spyOn(run_ship_planned, 'unplanned').mockResolvedValue(undefined)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function printed(): string {
	return vi
		.mocked(process.stdout.write)
		.mock.calls.map((call) => String(call[0]))
		.join('')
}

describe('run --join on a gate that passed before the tree moved', () => {
	it('exits with the moved code and says the gate passed, never Gate RED nor its log', async () => {
		expect(await run_review_cli.run(['--join'])).toBe(run_review.MOVED_EXIT_CODE)
		expect(printed()).toContain('Gate passed on an earlier tree')
		expect(printed()).not.toContain('Gate RED')
		expect(printed()).not.toContain(GATE_LOG)
	})

	it("ends the gate's timing at its green stamp, not at the join", async () => {
		await run_review_cli.run(['--join'])

		expect(run_review_steps.complete_timing).toHaveBeenCalledWith(
			expect.objectContaining({ gate_ended_at: GATE_TAKEN_AT }),
		)
	})
})

// joshuafolkken/kit#5388: a file a round-1 fix added surfaced only at the ship's preflight, after
// its pre-detach.
const UNPLANNED: Unplanned = {
	issue: 5388,
	files: ['scripts/run/run-step.ts'],
	text: 'unplanned: scripts/run/run-step.ts — run `pnpm josh lane:plan 5388 scripts/run/run-step.ts`',
}

describe('run --join on a lane plan the change outgrew', () => {
	it("prints the ship preflight's unplanned answer and keeps the gate's exit code", async () => {
		vi.spyOn(lane_ledger_write, 'record_unplanned_notice').mockResolvedValue()
		vi.mocked(run_ship_planned.unplanned).mockResolvedValue(UNPLANNED)

		expect(await run_review_cli.run(['--join'])).toBe(run_review.MOVED_EXIT_CODE)
		expect(console.info).toHaveBeenCalledExactlyOnceWith(UNPLANNED.text)
	})

	it('prints no unplanned answer where every changed file is planned', async () => {
		await run_review_cli.run(['--join'])

		expect(console.info).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4770: the background `josh test:pinned` answers at the join, and an unpinned
// change stops the round whatever the gate answered.

const LIST = 'Unpinned: scripts/a.ts:3\n'
const SITE = 'scripts/a.ts 0123456789abcdef'

function errored(): string {
	return vi
		.mocked(process.stderr.write)
		.mock.calls.map((call) => String(call[0]))
		.join('')
}

// joshuafolkken/kit#4878: the join after a round-1 fix reads the fixed tree's check;
// joshuafolkken/kit#5002: as it stands, never waiting the grace on a probe it just started.
describe('run --join on a tree a round-1 fix moved', () => {
	const fixed_tree = 'fixed-tree'

	beforeEach(() => {
		vi.mocked(run_review_pinned_steps.launched_tree).mockReturnValue('briefed-tree')
		vi.spyOn(run_review_pinned_tree, 'key').mockResolvedValue(fixed_tree)
		vi.spyOn(run_review_pinned_steps, 'clear').mockReturnValue(undefined)
		vi.spyOn(run_review_pinned_steps, 'is_pending').mockReturnValue(false)
	})

	it('starts the check again on the fixed tree and reads it without waiting', async () => {
		const launch = vi
			.spyOn(run_review_pinned_steps, 'launch')
			.mockReturnValue({ kind: 'launched', pid: 1 })
		const answer_now = vi.spyOn(run_review_pinned_steps, 'answer_now').mockReturnValue(undefined)

		await run_review_cli.run(['--join'])

		expect(launch).toHaveBeenCalledWith(expect.any(String), undefined, fixed_tree)
		expect(answer_now).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringContaining('started again on the moved tree'),
		)
		expect(run_review_pinned_steps.wait_for_answer).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4895: round 1 with fixes to make waits no grace on test:pinned.
describe('run --join --fixing', () => {
	it('reads the check as it stands rather than waiting on it', async () => {
		const answer_now = vi.spyOn(run_review_pinned_steps, 'answer_now').mockReturnValue(undefined)

		await run_review_cli.run(['--join', '--fixing'])

		expect(answer_now).toHaveBeenCalledOnce()
		expect(run_review_pinned_steps.wait_for_answer).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#4936: what a running check reached is printed, never judged as its answer.
	it("prints a partial answer and keeps the gate's exit code without judging it", async () => {
		const partial = { text: LIST, unpinned: [SITE], is_partial: true }

		vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		vi.spyOn(run_review_pinned_join, 'wait_for_join').mockResolvedValue(partial)
		const judge = vi.spyOn(run_review_pinned_accepted, 'judge')

		expect(await run_review_cli.run(['--join', '--fixing'])).toBe(run_review.MOVED_EXIT_CODE)
		expect(errored()).toBe(LIST)
		expect(judge).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#5188: a partial answer ends on its counts line too, the full list path above it.
	it('ends a partial answer on its counts line', async () => {
		const partial = { text: LIST, counts: 'COUNTS', log: { path: 'LOG' }, unpinned: [SITE] }

		vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		vi.spyOn(run_review_pinned_join, 'wait_for_join').mockResolvedValue({
			...partial,
			is_partial: true,
		})

		await run_review_cli.run(['--join', '--fixing'])

		expect(errored()).toBe(`${LIST}full output: LOG\nCOUNTS\n`)
	})
})

describe('run --join on the background test:pinned', () => {
	beforeEach(() => {
		vi.spyOn(process.stderr, 'write').mockReturnValue(true)
	})

	it('exits with the unpinned code and prints the list with the stop note on a green gate', async () => {
		vi.mocked(run_review_steps.wait_for_gate_finish).mockResolvedValue(GATE_GREEN)
		vi.mocked(run_review_pinned_steps.wait_for_answer).mockResolvedValue({
			text: LIST,
			unpinned: [SITE],
		})

		expect(await run_review_cli.run(['--join'])).toBe(run_review.UNPINNED_EXIT_CODE)
		expect(errored()).toBe(`${LIST}${run_review_pinned.STOP_NOTE}\n`)
	})

	it('exits with the unpinned code on a moved gate too', async () => {
		vi.mocked(run_review_pinned_steps.wait_for_answer).mockResolvedValue({
			text: LIST,
			unpinned: [SITE],
		})

		expect(await run_review_cli.run(['--join'])).toBe(run_review.UNPINNED_EXIT_CODE)
	})

	it("keeps the gate's exit code and prints the clear answer when nothing is unpinned", async () => {
		vi.mocked(run_review_steps.wait_for_gate_finish).mockResolvedValue(GATE_GREEN)
		vi.mocked(run_review_pinned_steps.wait_for_answer).mockResolvedValue({
			text: LIST,
			unpinned: [],
		})

		expect(await run_review_cli.run(['--join'])).toBe(0)
		expect(errored()).toBe(LIST)
	})
})

// An `--unpinned-ok` reason belongs to the launched check, so join must honor it while preserving
// the gate's exit code (joshuafolkken/kit#4793).

const REASON = 'the branch only logs'

describe('run --join on a test:pinned launched under --unpinned-ok', () => {
	beforeEach(() => {
		vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		vi.mocked(run_review_pinned_steps.launched_reason).mockReturnValue(REASON)
		vi.mocked(run_review_pinned_steps.wait_for_answer).mockResolvedValue({
			text: LIST,
			unpinned: [SITE],
		})
	})

	it("prints the list with the implementer's reason and keeps a green gate's exit code", async () => {
		vi.mocked(run_review_steps.wait_for_gate_finish).mockResolvedValue(GATE_GREEN)

		expect(await run_review_cli.run(['--join'])).toBe(0)
		expect(errored()).toBe(`${LIST}Unpinned accepted by the implementer: ${REASON}\n`)
	})

	it("keeps a moved gate's exit code", async () => {
		expect(await run_review_cli.run(['--join'])).toBe(run_review.MOVED_EXIT_CODE)
	})

	// joshuafolkken/kit#4775: the join is where the reason and its places are recorded for the branch.
	it('hands the answer and the reason to the record of accepted places', async () => {
		const judge = vi.spyOn(run_review_pinned_accepted, 'judge')

		await run_review_cli.run(['--join'])

		expect(judge).toHaveBeenCalledWith({ text: LIST, unpinned: [SITE] }, REASON)
	})
})
