import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MergeContext } from './run-merge-steps'

// joshuafolkken/kit#3884: a child whose unit was killed mid-turn is released once per invocation, and
// the release counts nothing.

const read_agent_state_mock = vi.hoisted(() => vi.fn())
const current_events_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())
const refused_carry_mock = vi.hoisted(() => vi.fn())
const reap_child_mock = vi.hoisted(() => vi.fn())
const unmark_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/run/run-liveness', () => ({
	run_liveness: { read_agent_state: read_agent_state_mock },
}))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { current_events: current_events_mock, emit: emit_mock },
}))
vi.mock('./run-merge-steps', () => ({ run_merge_steps: { refused_carry: refused_carry_mock } }))
vi.mock('#scripts/lane/lane-reap', () => ({ lane_reap: { reap_child: reap_child_mock } }))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: unmark_mock } }))

const { run_merge_interrupt } = await import('./run-merge-interrupt')

const CHILD = '3884'
const OTHER = '3865'
const OUTPUT = 'lane-3884.jsonl'
const INTERRUPT = 'interrupt'
const AT = '2026-10-16T00:00:00Z'

function interrupt_of(child: string): unknown {
	return { at: AT, kind: INTERRUPT, text: `#${child} interrupted` }
}

beforeEach(() => {
	read_agent_state_mock.mockReset().mockReturnValue({ result: 'running' })
	current_events_mock.mockReset().mockResolvedValue([])
	emit_mock.mockReset().mockResolvedValue(undefined)
	refused_carry_mock.mockReset().mockResolvedValue(undefined)
	reap_child_mock.mockReset()
	unmark_mock.mockReset().mockResolvedValue(undefined)
})

describe('run_merge_interrupt.is_interrupted', () => {
	it('reads a transcript cut short without an exit record as interrupted', async () => {
		expect(await run_merge_interrupt.is_interrupted(CHILD, OUTPUT)).toBe(true)
	})

	it('does not read a transcript that wrote its exit record as interrupted', async () => {
		read_agent_state_mock.mockReturnValue({ result: 'failed' })

		expect(await run_merge_interrupt.is_interrupted(CHILD, OUTPUT)).toBe(false)
	})

	it.each([
		{ name: 'no output was passed', output: undefined, state: { result: 'running' } },
		{ name: 'the transcript is unreadable', output: OUTPUT, state: undefined },
	])('does not read an interruption when $name', async ({ output, state }) => {
		read_agent_state_mock.mockReturnValue(state)

		expect(await run_merge_interrupt.is_interrupted(CHILD, output)).toBe(false)
	})

	it('reads a second interruption of the same child in one invocation as a failure', async () => {
		current_events_mock.mockResolvedValue([interrupt_of(CHILD)])

		expect(await run_merge_interrupt.is_interrupted(CHILD, OUTPUT)).toBe(false)
	})

	it('is not spent by another child’s interruption', async () => {
		current_events_mock.mockResolvedValue([interrupt_of(OTHER)])

		expect(await run_merge_interrupt.is_interrupted(CHILD, OUTPUT)).toBe(true)
	})

	it('is not spent by the child’s own launch', async () => {
		current_events_mock.mockResolvedValue([
			{ at: AT, kind: 'child-launch', text: `#${CHILD} dispatched` },
		])

		expect(await run_merge_interrupt.is_interrupted(CHILD, OUTPUT)).toBe(true)
	})
})

describe('run_merge_interrupt.release', () => {
	const ctx: MergeContext = {
		child: CHILD,
		epic: undefined,
		repo: undefined,
		over: undefined,
		owner: {},
	}

	it('reaps the unit, drops in-progress and records the interruption', async () => {
		expect(await run_merge_interrupt.release(ctx)).toBeUndefined()
		expect(reap_child_mock).toHaveBeenCalledWith(CHILD)
		expect(unmark_mock).toHaveBeenCalledWith(CHILD)
		expect(emit_mock).toHaveBeenCalledWith(INTERRUPT, `#${CHILD} interrupted (re-dispatchable)`)
	})

	it('touches nothing when this session does not own the carry record', async () => {
		const carry = { failures: 0, owner_pid: 99_999 }

		refused_carry_mock.mockResolvedValue(carry)

		expect(await run_merge_interrupt.release(ctx)).toBe(carry)
		expect(reap_child_mock).not.toHaveBeenCalled()
		expect(emit_mock).not.toHaveBeenCalled()
	})
})
