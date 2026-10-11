import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_change } from '#scripts/run/carry/run-carry-change'
import { run_headless } from '#scripts/run/run-headless'
import { run_step } from '#scripts/run/run-step'
import { run_wake, type WakeDecision } from '#scripts/run/wake/run-wake'
import { run_wake_driver } from '#scripts/run/wake/run-wake-driver'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backlog_budget, type BudgetInput } from './backlog-budget'
import { backlog_budget_cli } from './backlog-budget-cli'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_next } from './backlog-next'
import { backlog_offer } from './backlog-offer'

// joshuafolkken/kit#3665: a `backlogrun` begun on an empty backlog ended in about two minutes instead of
// entering its idle watch. Every piece of the watch worked; nothing carried the run from `--begin` to
// the driver that runs it. This walks that path through the real decisions, end to end: the begun
// record, the parent's next action, the supervisor's answer, the driver's flags, the offer, the budget
// and the loop.

const { CONFIG, POLL_MS, harness, offer, state } = backlog_drive_fixture
const NOW = new Date('2026-10-11T02:49:50.000Z')
const OWNER_PID = 4242
const NO_ATTEMPTS = 0
const NONE_RUNNING = 0
const NO_RETRIES = 0
// `backlog:drive`, `--owner` and the supervisor's pid lead the driver's argv; the budget flags follow.
const DRIVER_FLAG_OFFSET = 3
const scratch = { directory: '', target: '' }

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-empty-start-'))
	scratch.target = path.join(scratch.directory, 'carry.json')
})

afterEach(() => {
	rmSync(scratch.directory, { recursive: true, force: true })
})

function begin(invocation: string): RunCarry {
	const carry = run_carry.begin_carry(scratch.target, invocation, { pid: OWNER_PID }, NOW)

	if (carry === undefined) throw new Error('the carry record was not created')

	return carry
}

// What the supervisor answers while the parent session that began the record is still alive.
function supervisor_answer(carry: RunCarry): WakeDecision['kind'] {
	return run_wake.decide({
		read: { kind: 'carried', carry },
		woke_at: undefined,
		attempts: NO_ATTEMPTS,
		is_owner_live: true,
		now: NOW,
	}).kind
}

// What the bare `run:step` prints for the session that began the record, having dispatched nothing.
function parent_step(carry: RunCarry): string {
	const read = { kind: 'carried', carry } as const
	const is_driving = run_headless.driven_here(read, () => new Set([OWNER_PID])) !== undefined

	return run_step.parent_action({
		carry_kind: read.kind,
		is_driving,
		is_handed_off: carry.is_handed_off === true,
		is_at_cut_cap: false,
		last_event: undefined,
		is_lane_child: false,
		is_retrospective_done: false,
		is_consumer: false,
		is_retrospective_enabled: false,
	}).line
}

// The budget question the driver asks on its first pass over an empty backlog: `backlog:next` answered
// `none`, and the invocation's own flags reach `backlog:budget` through the supervisor's driver argv.
function empty_backlog_budget(invocation: string): BudgetInput {
	const flags = run_wake_driver.driver_args(invocation)?.slice(DRIVER_FLAG_OFFSET) ?? []
	const next = { code: 0, tokens: [backlog_next.VERDICT_TOKENS.complete] }
	const { answer } = backlog_offer.answer_of(next, NONE_RUNNING, NO_RETRIES)
	const at = NOW.toISOString()
	const argv = ['--answer', answer, '--started', at, '--active', at, ...flags]
	const values = backlog_budget_cli.read_arguments(argv)
	const input = values && backlog_budget_cli.build_input(values, NOW.getTime())

	if (input === undefined) throw new Error('the budget input could not be built')

	return input
}

interface Driven {
	reason: string
	calls: ReadonlyArray<string>
}

// One bounded stretch of the driver's loop on that budget answer.
async function drive(input: BudgetInput): Promise<Driven> {
	const { verdict } = backlog_budget.decide(input)
	const is_finish = backlog_budget.is_finish(input)
	const { ports, calls } = harness({
		offers: [{ ...offer(verdict), answer: input.answer, is_finish }],
	})
	const end = await backlog_drive.run_loop(state(), { ...CONFIG, window_ms: POLL_MS }, ports)

	return { reason: end.reason, calls }
}

describe('a backlogrun begun on an empty backlog — reaching the driver', () => {
	it('is left waiting by the supervisor until the parent hands it off', () => {
		expect(supervisor_answer(begin('backlogrun'))).toBe('wait')
	})

	it('is handed off by what the bare run:step prints, though nothing was dispatched', () => {
		expect(parent_step(begin('backlogrun'))).toBe(run_step.HAND_OFF_COMMAND)
	})

	it('starts the driver once the cut is taken, and stops the session that took it', () => {
		const handed_off = run_carry_change.apply_change(scratch.target, begin('backlogrun'), {
			cuts: 1,
		})

		expect(supervisor_answer(handed_off)).toBe('wake')
		expect(handed_off.is_handed_off).toBe(true)
	})
})

describe('a backlogrun begun on an empty backlog — inside the driver', () => {
	it('watches for the default idle budget instead of ending', async () => {
		const budget = empty_backlog_budget('backlogrun')
		const driven = await drive(budget)

		expect(budget.idle_budget_ms).toBe(backlog_budget.DEFAULT_IDLE_MS)
		expect(backlog_budget.decide(budget).verdict).toBe(backlog_budget.WATCH_VERDICT)
		expect(driven.reason).toBe('window')
		expect(driven.calls).not.toContain('finish')
	})

	it('ends at once when the invocation turned the watch off with --idle 0', async () => {
		const budget = empty_backlog_budget('backlogrun --idle 0')
		const driven = await drive(budget)

		expect(backlog_budget.decide(budget).reason).toBe(backlog_budget.NO_IDLE_WATCH_REASON)
		expect(driven.reason).toBe('stop')
		expect(driven.calls).toContain('finish')
	})
})
