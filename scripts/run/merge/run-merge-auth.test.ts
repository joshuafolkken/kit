import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_merge_token } from './run-merge-token'

// joshuafolkken/kit#4216, #7078: a child whose session could not authenticate holds launches without
// ending the run — it is neither parked nor counted but released, and the run's first hold tells a
// person to run `/login`. The exit record is the one #4185's child wrote, read through the real
// `api_auth` and `agent_exit_record`.

const read_issue_mock = vi.hoisted(() => vi.fn())
const transcript_mock = vi.hoisted(() => vi.fn<() => string>())
const mid_turn_mock = vi.hoisted(() => vi.fn<() => boolean>())
const do_failed_mock = vi.hoisted(() => vi.fn())
const do_outage_mock = vi.hoisted(() => vi.fn())
const release_child_mock = vi.hoisted(() => vi.fn())
const ask_next_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())
const confirm_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const events_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))
vi.mock('#scripts/issue/issue-closing-pr')
vi.mock('#scripts/lane/lane-ledger-write')
vi.mock('./run-merge-ship')
vi.mock('#scripts/notify/telegram-notify', () => ({ telegram_notify: { confirm: confirm_mock } }))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: emit_mock, current_events: events_mock },
}))
vi.mock('#scripts/run/run-ending', async () => {
	const { agent_exit_record } = await import('#scripts/agent/agent-exit-record')

	return {
		run_ending: {
			ended_mid_turn: mid_turn_mock,
			read_exit: (): unknown => agent_exit_record.read_exit_record(transcript_mock()),
			read_transcript: transcript_mock,
			written_at: vi.fn(),
		},
	}
})
vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: ask_next_mock,
		do_failed: do_failed_mock,
		do_outage: do_outage_mock,
		has_resumable_cut: async () => false,
		release_child: release_child_mock,
	},
}))

const { run_merge_cli } = await import('./run-merge-cli')

const CHILD = '4185'
const OUTPUT_ARGS = [CHILD, '--output', 'child.jsonl']
const SUCCESS = 0
const USAGE_LIMIT_KIND = 'usage-limit'
const OUTAGE_KIND = 'outage'
const LOGIN_NOTICE = {
	issue_title: 'backlogrun waiting: Claude authentication failed',
	recommended: 'Run /login',
	alternatives: ['Stop the run with `pnpm josh backlogrun --stop`'],
	body: expect.stringContaining(
		'could not authenticate — run /login; the run resumes by itself. Launches are held and re-tried every 10 minutes; the child was released, neither parked nor counted as a failure.',
	) as unknown,
}
const AUTH_FAILED_LINE = JSON.stringify({
	type: 'result',
	subtype: 'success',
	is_error: true,
	error: 'authentication_failed',
	result: 'Failed to authenticate: OAuth session expired and could not be refreshed',
	terminal_reason: 'api_error',
})
const OUTAGE_LINE = JSON.stringify({
	type: 'result',
	is_error: true,
	result: 'API Error: Unable to connect to API (ConnectionRefused)',
})

beforeEach(() => {
	read_issue_mock.mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: ['in-progress'], is_human_review: false },
	})
	transcript_mock.mockReturnValue(AUTH_FAILED_LINE)
	mid_turn_mock.mockReturnValue(false)
	events_mock.mockReset().mockResolvedValue([])
	emit_mock.mockReset()
	confirm_mock.mockReset()
	release_child_mock.mockReset()
	ask_next_mock.mockReset().mockResolvedValue('7000')
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
})

describe('run_merge_cli.run — a child that could not authenticate', () => {
	it('holds launches without ending the run, parking the child or counting it', async () => {
		expect(await run_merge_cli.run(OUTPUT_ARGS)).toBe(SUCCESS)
		expect(info_mock).not.toHaveBeenCalledWith(run_merge_token.MERGE_TOKEN.ENVIRONMENT)
		expect(emit_mock).toHaveBeenCalledWith(
			USAGE_LIMIT_KIND,
			expect.stringContaining('authentication failure'),
		)
		expect(emit_mock).not.toHaveBeenCalledWith(OUTAGE_KIND, expect.anything())
		expect(do_failed_mock).not.toHaveBeenCalled()
		expect(do_outage_mock).not.toHaveBeenCalled()
		expect(release_child_mock).toHaveBeenCalledWith(CHILD)
		expect(ask_next_mock).toHaveBeenCalledOnce()
	})

	it('tells a person to run /login on the first hold only', async () => {
		await run_merge_cli.run(OUTPUT_ARGS)
		events_mock.mockResolvedValue([{ kind: USAGE_LIMIT_KIND, text: emit_mock.mock.calls[0]?.[1] }])
		await run_merge_cli.run(OUTPUT_ARGS)

		expect(confirm_mock).toHaveBeenCalledOnce()
		expect(confirm_mock).toHaveBeenCalledWith(expect.objectContaining(LOGIN_NOTICE))
	})

	it('leaves a connection failure on the outage path', async () => {
		transcript_mock.mockReturnValue(OUTAGE_LINE)
		do_outage_mock.mockResolvedValue({ carry: { outages: 1 }, is_refused: false })

		await run_merge_cli.run(OUTPUT_ARGS)

		expect(do_outage_mock).toHaveBeenCalledOnce()
		expect(confirm_mock).not.toHaveBeenCalled()
	})
})

describe('run_merge_cli.run — an authentication failure after a merge', () => {
	it('tells a person again, the earlier hold being before the merge', async () => {
		await run_merge_cli.run(OUTPUT_ARGS)
		const hold = { kind: USAGE_LIMIT_KIND, text: emit_mock.mock.calls[0]?.[1] }

		events_mock.mockResolvedValue([hold, { kind: 'merge', text: '#7000' }])
		await run_merge_cli.run(OUTPUT_ARGS)

		expect(confirm_mock).toHaveBeenCalledTimes(2)
	})
})

describe('run_merge_cli.run — a resumed child after an earlier authentication failure', () => {
	it('reads a resumed child killed mid-turn as an outage, not the earlier session it follows', async () => {
		transcript_mock.mockReturnValue(`${AUTH_FAILED_LINE}\n{"type":"assistant"}\n`)
		mid_turn_mock.mockReturnValue(true)
		do_outage_mock.mockResolvedValue({ carry: { outages: 1 }, is_refused: false })

		await run_merge_cli.run(OUTPUT_ARGS)

		expect(do_outage_mock).toHaveBeenCalledOnce()
		expect(confirm_mock).not.toHaveBeenCalled()
	})

	it('does not stop the run for a resumed child that died on a non-JSON start-up error', async () => {
		transcript_mock.mockReturnValue(`${AUTH_FAILED_LINE}\nError: unexpected start-up failure\n`)
		do_failed_mock.mockResolvedValue({ is_refused: true, carry: undefined })

		await run_merge_cli.run(OUTPUT_ARGS)

		expect(do_failed_mock).toHaveBeenCalledOnce()
		expect(confirm_mock).not.toHaveBeenCalled()
	})
})
