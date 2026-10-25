import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_merge_steps_fixture } from './run-merge-steps-fixture'

// joshuafolkken/kit#3017: a child that parked itself has its `in-progress` dropped, as a failed child's
// is — left on, it outlived the `needs-decision` a person lifted and held the backlog.

const read_issue_mock = vi.hoisted(() => vi.fn())
const release_mock = vi.hoisted(() => vi.fn())
const record_merge_mock = vi.hoisted(() => vi.fn())
const record_change_mock = vi.hoisted(() => vi.fn())
const do_failed_mock = vi.hoisted(() => vi.fn())
const do_merged_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())
const events_mock = vi.hoisted(() => vi.fn())
const restart_mock = vi.hoisted(() => vi.fn())
const merge_state_mock = vi.hoisted(() => vi.fn())

vi.mock('./run-merge-restart', () => ({
	run_merge_restart: { is_host_restart: restart_mock },
}))

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))

vi.mock('#scripts/issue/issue-closing-pr', () => ({
	issue_closing_pr: { read_closing_pr: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/issue/issue-merged', () => ({
	issue_merged: {
		read_merged: vi.fn().mockResolvedValue(false),
		read_merge_state: merge_state_mock,
	},
}))

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: {
		emit: emit_mock,
		current_events: events_mock,
		invocation_or_all_events: events_mock,
	},
}))

vi.mock('#scripts/lane/lane-ledger', () => ({
	lane_ledger: { record_merge: record_merge_mock },
}))

vi.mock('#scripts/lane/lane-state', () => ({
	lane_state: { record_change: record_change_mock },
}))

vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: vi.fn().mockResolvedValue('2039'),
		do_failed: do_failed_mock,
		release_child: release_mock,
		do_merged: do_merged_mock,
		has_resumable_cut: vi.fn().mockResolvedValue(false),
		is_over_budget: vi.fn().mockResolvedValue(false),
		refused_carry: vi.fn().mockResolvedValue(undefined),
		resume_cut: vi.fn().mockResolvedValue(false),
	},
}))

const { run_merge_cli } = await import('./run-merge-cli')

const CHILD = '2987'
const IN_PROGRESS = 'in-progress'
const NEEDS_DECISION = 'needs-decision'
const CLOSED_STATE = { kind: 'state', state: { state: 'CLOSED', labels: [] } }

function context(): NonNullable<ReturnType<typeof run_merge_cli.parse>> {
	const ctx = run_merge_cli.parse([CHILD])

	if (ctx === undefined) throw new Error('unparsable test arguments')

	return ctx
}

function open_with(labels: ReadonlyArray<string>): unknown {
	return { kind: 'state', state: { state: 'OPEN', labels } }
}

beforeEach(() => {
	read_issue_mock.mockReset()
	release_mock.mockReset().mockResolvedValue(true)
	record_merge_mock.mockReset().mockResolvedValue(undefined)
	record_change_mock.mockReset().mockResolvedValue({ kind: 'skipped', reason: 'test' })
	do_failed_mock.mockReset()
	do_merged_mock.mockReset().mockImplementation(run_merge_steps_fixture.record_merged)
	emit_mock.mockReset().mockResolvedValue(undefined)
	events_mock.mockReset().mockResolvedValue([])
	restart_mock.mockReset().mockResolvedValue(false)
	merge_state_mock.mockReset().mockResolvedValue(true)
})

// joshuafolkken/kit#3908: a child a person withdrew is settled by `lane:withdraw`, so `run:merge` offers
// the next child and counts, parks and records nothing — whatever GitHub's state reads.
describe('run_merge_cli.merge_child — a child a person withdrew', () => {
	const WITHDRAW_EVENT = {
		pos: 1,
		at: '2026-10-16T00:00:00.000Z',
		kind: 'withdraw',
		text: `#${CHILD} withdrawn by a person: x`,
	}

	it.each([
		['OPEN', open_with([IN_PROGRESS])],
		['CLOSED', CLOSED_STATE],
	])('offers the next child for a withdrawn %s issue', async (_label, state) => {
		read_issue_mock.mockResolvedValue(state)
		events_mock.mockResolvedValue([WITHDRAW_EVENT])
		merge_state_mock.mockResolvedValue(false)

		const result = await run_merge_cli.merge_child(context())

		expect(result).toStrictEqual({ outcome: 'withdrawn', token: '2039', code: 0, is_offer: true })
		expect(do_failed_mock).not.toHaveBeenCalled()
		expect(record_merge_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#3502: a child released to wait on an open blocker is settled without a count, so
// the next child is offered and the failure guard is never read.
describe('run_merge_cli.merge_child — a child waiting on an open blocker', () => {
	it('offers the next child and puts the wait on the stream', async () => {
		read_issue_mock.mockResolvedValue(open_with([IN_PROGRESS]))
		do_failed_mock.mockResolvedValue({
			carry: undefined,
			is_parked: false,
			is_refused: false,
			waits: ['#3501'],
		})

		const result = await run_merge_cli.merge_child(context())

		expect(result).toStrictEqual({ outcome: 'failed', token: '2039', code: 0, is_offer: true })
		expect(emit_mock).toHaveBeenCalledWith('park', `#${CHILD} waiting on #3501`)
	})
})

// joshuafolkken/kit#4215: the park event carries the cause, so the board row can name it.
describe('run_merge_cli.merge_child — a park that gave no cause', () => {
	it('names a session that ended unfinished', async () => {
		read_issue_mock.mockResolvedValue(open_with([IN_PROGRESS]))
		do_failed_mock.mockResolvedValue({
			carry: undefined,
			is_parked: true,
			is_refused: false,
			waits: [],
		})

		await run_merge_cli.merge_child(context())

		expect(emit_mock).toHaveBeenCalledWith(
			'park',
			`#${CHILD} parked (run:stalled: session unfinished)`,
		)
	})
})

// joshuafolkken/kit#4765: the cap's line reaches the park only when merge_child hands it to do_failed.
describe('run_merge_cli.merge_child — a child the re-dispatch cap stopped', () => {
	it('hands the cap line to the failed step', async () => {
		const outage = { at: '2026-10-24T00:00:00.000Z', kind: 'outage', text: `#${CHILD} outage` }

		read_issue_mock.mockResolvedValue(open_with([IN_PROGRESS]))
		restart_mock.mockResolvedValue(true)
		events_mock.mockResolvedValue([1, 2, 3].map((pos) => ({ ...outage, pos })))
		do_failed_mock.mockResolvedValue({ carry: undefined, is_parked: true, waits: [] })

		await run_merge_cli.merge_child(context())

		const [handed] = do_failed_mock.mock.lastCall as [{ capped_note?: string }]

		expect(handed.capped_note).toContain('re-dispatch cap (3) after 3 re-dispatches')
	})
})

describe('run_merge_cli.merge_child — in-progress on a settled child', () => {
	it.each([NEEDS_DECISION, 'already-done'])(
		'drops in-progress from a child parked with %s',
		async (label) => {
			read_issue_mock.mockResolvedValue(open_with([IN_PROGRESS, label]))

			const result = await run_merge_cli.merge_child(context())

			expect(result.outcome).toBe('parked')
			expect(release_mock).toHaveBeenCalledWith(CHILD)
		},
	)

	it('leaves the label of a merged child to the merge step', async () => {
		read_issue_mock.mockResolvedValue(CLOSED_STATE)

		const result = await run_merge_cli.merge_child(context())

		expect(result.outcome).toBe('merged')
		expect(release_mock).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#3355: the lane-limit measurement counts merges from the ledger.
	it('records a merged child in the lane ledger', async () => {
		read_issue_mock.mockResolvedValue(CLOSED_STATE)

		await run_merge_cli.merge_child(context())

		expect(record_merge_mock).toHaveBeenCalledWith(
			Number(CHILD),
			run_merge_steps_fixture.CONFIRMED_AT,
		)
	})

	it('records nothing for a parked child', async () => {
		read_issue_mock.mockResolvedValue(open_with([IN_PROGRESS, NEEDS_DECISION]))

		await run_merge_cli.merge_child(context())

		expect(record_merge_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4300: a merged child's lane is ended on its state record by `lane:close` alone, so
// a close that came back `incomplete` does not read as ended.
describe('run_merge_cli.merge_child — the lane state record', () => {
	it('leaves a merged child’s ended record to lane:close', async () => {
		read_issue_mock.mockResolvedValue(CLOSED_STATE)

		await run_merge_cli.merge_child(context())

		expect(record_change_mock).not.toHaveBeenCalled()
	})

	it('records no state for a parked child', async () => {
		read_issue_mock.mockResolvedValue(open_with([IN_PROGRESS, NEEDS_DECISION]))

		await run_merge_cli.merge_child(context())

		expect(record_change_mock).not.toHaveBeenCalled()
	})
})
