import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#6502: a child GitHub stopped — a 403 rate limit, or an expired `gh` login — is an
// outage, re-dispatchable and never counted against the failure guard; any other stop stays a failed
// child. The transcripts end the way #6465's did: `gh` failed in a tool result, then the child
// stopped on its own with a clean exit record.

const read_issue_mock = vi.hoisted(() => vi.fn())
const transcript_mock = vi.hoisted(() => vi.fn<() => string>())
const do_failed_mock = vi.hoisted(() => vi.fn())
const do_outage_mock = vi.hoisted(() => vi.fn())
const events_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))
vi.mock('#scripts/issue/issue-closing-pr')
vi.mock('#scripts/lane/lane-ledger-write')
vi.mock('./run-merge-ship')
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: vi.fn(), current_events: events_mock },
}))
vi.mock('#scripts/run/run-ending', async () => {
	const { agent_exit_record } = await import('#scripts/agent/agent-exit-record')

	return {
		run_ending: {
			ended_mid_turn: () => false,
			read_exit: (): unknown => agent_exit_record.read_exit_record(transcript_mock()),
			read_transcript: transcript_mock,
			written_at: (): number => Date.now(),
		},
	}
})
vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: async () => 'none',
		do_failed: do_failed_mock,
		do_outage: do_outage_mock,
		has_resumable_cut: async () => false,
		release_child: vi.fn(),
	},
}))

const { run_merge_cli } = await import('./run-merge-cli')

const CHILD = '6465'
const OUTPUT_ARGS = [CHILD, '--output', 'child.jsonl']
const EXIT_LINE = JSON.stringify({
	type: 'result',
	subtype: 'success',
	is_error: false,
	result: 'Stopped before the merge: GitHub refused the request.',
})

function stopped_on(tool_output: string): string {
	const tool_line = JSON.stringify({
		type: 'user',
		message: { content: [{ type: 'tool_result', content: tool_output, is_error: true }] },
	})

	return `{"type":"system"}\n${tool_line}\n${EXIT_LINE}\n`
}

beforeEach(() => {
	read_issue_mock.mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: ['in-progress'], is_human_review: false },
	})
	do_outage_mock.mockResolvedValue({ carry: undefined, is_refused: false })
	do_failed_mock.mockResolvedValue({ carry: undefined, is_refused: false, waits: [] })
	events_mock.mockResolvedValue([])
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
})

describe('run_merge_cli.run — a child GitHub stopped', () => {
	it('reads a 403 rate limit as an outage, counting no failure', async () => {
		transcript_mock.mockReturnValue(
			stopped_on('gh: API rate limit exceeded for user ID 1234. (HTTP 403)'),
		)

		await run_merge_cli.run(OUTPUT_ARGS)

		expect(do_outage_mock).toHaveBeenCalledWith(expect.objectContaining({ is_streak_exempt: true }))
		expect(do_failed_mock).not.toHaveBeenCalled()
	})

	it('reads an expired gh login as an outage', async () => {
		transcript_mock.mockReturnValue(
			stopped_on('HTTP 401: Bad credentials (https://api.github.com/)'),
		)

		await run_merge_cli.run(OUTPUT_ARGS)

		expect(do_outage_mock).toHaveBeenCalledWith(
			expect.objectContaining({ is_streak_exempt: false }),
		)
		expect(do_failed_mock).not.toHaveBeenCalled()
	})

	it('leaves any other stop a failed child', async () => {
		transcript_mock.mockReturnValue(stopped_on('FAIL scripts/a.test.ts — expected 1 to be 2'))

		await run_merge_cli.run(OUTPUT_ARGS)

		expect(do_failed_mock).toHaveBeenCalledOnce()
		expect(do_outage_mock).not.toHaveBeenCalled()
	})
})
