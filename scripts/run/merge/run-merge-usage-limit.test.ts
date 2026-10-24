import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4745: a child a Claude usage limit stopped is released uncounted and unparked, and
// the reset its exit record names is written to the event stream for `backlog:drive` to wait out. The
// exit record is the one the 2026-10-23 children wrote, read through the real `api_usage_limit`.

const read_issue_mock = vi.hoisted(() => vi.fn())
const transcript_mock = vi.hoisted(() => vi.fn<() => string>())
const do_failed_mock = vi.hoisted(() => vi.fn())
const do_outage_mock = vi.hoisted(() => vi.fn())
const release_child_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())
const events_mock = vi.hoisted(() => vi.fn())
// The 2026-10-23 stop, read at the time it was written: 10am Tokyo is 01:00 UTC the next day.
const STOPPED_MS = vi.hoisted(() => Date.parse('2026-10-23T16:50:00.000Z'))

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))
vi.mock('#scripts/issue/issue-closing-pr')
vi.mock('#scripts/lane/lane-ledger')
vi.mock('./run-merge-ship')
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: emit_mock, current_events: events_mock },
}))
vi.mock('#scripts/run/run-ending', async () => {
	const { agent_exit_record } = await import('#scripts/agent/agent-exit-record')

	return {
		run_ending: {
			ended_mid_turn: () => false,
			read_exit: (): unknown => agent_exit_record.read_exit_record(transcript_mock()),
			read_transcript: transcript_mock,
			written_at: (): number => STOPPED_MS,
		},
	}
})
vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: async () => 'none',
		do_failed: do_failed_mock,
		do_outage: do_outage_mock,
		has_resumable_cut: async () => false,
		release_child: release_child_mock,
	},
}))

const { run_merge_cli } = await import('./run-merge-cli')
const { run_merge_usage_limit } = await import('./run-merge-usage-limit')

const CHILD = '4745'
const OUTPUT_ARGS = [CHILD, '--output', 'child.jsonl']
const KIND = 'usage-limit'
const STOPPED_AT = new Date(STOPPED_MS)
const RESET_ISO = '2026-10-24T01:00:00.000Z'
const RESET_MS = Date.parse(RESET_ISO)
const LIMIT_LINE = JSON.stringify({
	type: 'result',
	subtype: 'success',
	is_error: true,
	result: "You've hit your weekly limit · resets 10am (Asia/Tokyo)",
})

function event(pos: number, text: string, kind = KIND): unknown {
	return { pos, at: STOPPED_AT.toISOString(), kind, text }
}

beforeEach(() => {
	vi.clearAllMocks()
	read_issue_mock.mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: ['in-progress'], is_human_review: false },
	})
	transcript_mock.mockReturnValue(`{"type":"system"}\n${LIMIT_LINE}\n`)
	events_mock.mockResolvedValue([])
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
})

describe('run_merge_cli.run — a child a usage limit stopped', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'], now: STOPPED_AT })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('counts, parks and outages nothing', async () => {
		await run_merge_cli.run(OUTPUT_ARGS)

		expect(do_failed_mock).not.toHaveBeenCalled()
		expect(do_outage_mock).not.toHaveBeenCalled()
		expect(emit_mock).not.toHaveBeenCalledWith('outage', expect.anything())
	})

	it('releases the child and records the reset on the event stream', async () => {
		await run_merge_cli.run(OUTPUT_ARGS)

		expect(release_child_mock).toHaveBeenCalledWith(CHILD)
		expect(emit_mock).toHaveBeenCalledWith(KIND, `#${CHILD} usage limit — resumes at ${RESET_ISO}`)
	})
})

describe('run_merge_usage_limit.resume_ms', () => {
	it('reads the reset of the newest usage-limit stop', () => {
		const events = [
			event(1, '#1 usage limit — resumes at 2026-10-23T00:00:00.000Z'),
			event(2, `#2 usage limit — resumes at ${RESET_ISO}`),
			event(3, '#3 parked', 'park'),
		]

		expect(run_merge_usage_limit.resume_ms(events as never)).toBe(RESET_MS)
	})

	it('reads no reset from a stream without one, or from a stop whose time does not parse', () => {
		const unparsed = [event(1, '#1 usage limit — resumes at soon')]

		expect(run_merge_usage_limit.resume_ms([])).toBeUndefined()
		expect(run_merge_usage_limit.resume_ms(unparsed as never)).toBeUndefined()
	})
})

describe('run_merge_usage_limit.is_held', () => {
	beforeEach(() => {
		events_mock.mockResolvedValue([event(1, `#1 usage limit — resumes at ${RESET_ISO}`)])
	})

	it('holds launches before the reset', async () => {
		await expect(run_merge_usage_limit.is_held(RESET_MS - 1)).resolves.toBe(true)
	})

	it('releases launches once the reset has passed', async () => {
		await expect(run_merge_usage_limit.is_held(RESET_MS)).resolves.toBe(false)
	})
})
