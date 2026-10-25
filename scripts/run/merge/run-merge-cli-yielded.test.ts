import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4926: a child that gave its lane back on its `lane:plan` noted the yield and ended
// with its issue OPEN. `run:merge` collects it as yielded — no merge event, no failure — and closes its
// lane through `lane:withdraw`'s path, named as the yield.

const emit_mock = vi.hoisted(() => vi.fn())
const do_merged_mock = vi.hoisted(() => vi.fn())
const withdraw_mock = vi.hoisted(() => vi.fn())
const CHILD = vi.hoisted(() => '4926')
const EVENTS = vi.hoisted(() => [
	{ pos: 1, at: '2026-10-26T00:00:00.000Z', kind: 'child-launch', text: `#${CHILD} dispatched` },
	{ pos: 2, at: '2026-10-26T00:01:00.000Z', kind: 'note', text: `#${CHILD} yielded its lane: x` },
])

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: {
		read_issue: vi.fn().mockResolvedValue({ kind: 'state', state: { state: 'OPEN', labels: [] } }),
	},
}))
vi.mock('#scripts/issue/issue-closing-pr')
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: {
		emit: emit_mock,
		current_events: vi.fn().mockResolvedValue(EVENTS),
		invocation_or_all_events: vi.fn().mockResolvedValue(EVENTS),
	},
}))
vi.mock('#scripts/lane/lane-withdraw-closed', () => ({
	lane_withdraw_closed: { withdraw_lane: withdraw_mock },
}))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: vi.fn().mockResolvedValue({ issue: CHILD }) },
}))
vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: vi.fn().mockResolvedValue('2039'),
		do_merged: do_merged_mock,
		has_resumable_cut: vi.fn().mockResolvedValue(false),
		is_over_budget: vi.fn().mockResolvedValue(false),
		refused_carry: vi.fn().mockResolvedValue(undefined),
	},
}))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: vi.fn() } }))

const { lane_yield } = await import('#scripts/lane/lane-yield')
const { run_merge_cli } = await import('./run-merge-cli')

function context(): NonNullable<ReturnType<typeof run_merge_cli.parse>> {
	const ctx = run_merge_cli.parse([CHILD])

	if (ctx === undefined) throw new Error('unparsable test arguments')

	return ctx
}

beforeEach(() => {
	emit_mock.mockReset().mockResolvedValue(undefined)
	do_merged_mock.mockReset().mockResolvedValue(undefined)
	withdraw_mock.mockReset().mockResolvedValue({ note: 'yielded', is_retry: false })
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_merge_cli.merge_child — a child that yielded its lane', () => {
	it('is collected as yielded and offers the next child', async () => {
		const result = await run_merge_cli.merge_child(context())

		expect(result).toStrictEqual({ outcome: 'yielded', token: '2039', code: 0, is_offer: true })
		expect(do_merged_mock).not.toHaveBeenCalled()
	})

	it('closes its lane named as the yield', async () => {
		await run_merge_cli.merge_child(context())

		expect(withdraw_mock).toHaveBeenCalledWith({ issue: CHILD }, lane_yield.YIELD_REASON, 'yield')
	})
})
