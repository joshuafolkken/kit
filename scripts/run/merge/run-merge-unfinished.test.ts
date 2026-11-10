import { run_board_ending_reason } from '#scripts/run/board/run-board-ending-reason'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { run_ending } from '#scripts/run/run-ending'
import { describe, expect, it, vi } from 'vitest'
import { run_merge_decision } from './run-merge-decision'
import { run_merge_decision_fixture } from './run-merge-decision-fixture'

const CHILD = '6336'
const OUTPUT = '/stub/6336.log'
const MESSAGE = 'The implementation session started.'

function judgment(message: string): ReturnType<typeof run_merge_decision.cause> {
	vi.spyOn(run_ending, 'read_transcript').mockReturnValue(
		run_merge_decision_fixture.transcript(message),
	)

	return run_merge_decision.cause(OUTPUT)
}

describe('unfinished session cause', () => {
	it('uses the first final-message line in the park comment (ac-642d189b)', () => {
		const cause = judgment(`${MESSAGE}\nAnother line.`)
		const options = run_merge_decision.park_options(cause, {
			child: CHILD,
			cause: cause.why,
			carry: undefined,
			output: OUTPUT,
		})

		expect(options.comment).toContain(`- Why: ${MESSAGE}\n`)
		expect(options.comment).not.toContain('Another line.')
	})
})

describe('unfinished session recovery', () => {
	it('names cut cleanup before retry for a handed-off cut', () => {
		const cause = judgment('The cut returned handed-off; the session stopped.')
		const options = run_merge_decision.park_options(cause, {
			child: CHILD,
			cause: cause.why,
			carry: undefined,
			output: OUTPUT,
		})

		expect(options.comment).toContain('clear the handed-off cut with `pnpm josh run:cut --end`')
		expect(options.comment).toContain(`then use \`pnpm josh run:add ${CHILD} --retry\``)
	})
})

describe('unfinished session event', () => {
	it('carries the same first line through the park event to the board (ac-750e08c3)', () => {
		const cause = judgment(`${MESSAGE}\nAnother line.`)
		const reason = run_board_ending_reason.reason_of({
			pos: 1,
			at: '',
			kind: run_event_stream.EVENT_KIND.PARK,
			text: run_merge_decision.park_event(CHILD, cause.short),
		})

		expect(run_board_ending_reason.park_row_reason(Number(CHILD), reason ?? '', true)).toBe(
			`→ resume: pnpm josh run:add ${CHILD} --retry (session unfinished: ${MESSAGE})`,
		)
	})

	it('retains the original cause and recovery without a message (ac-78eafcca)', () => {
		expect(judgment('')).toBe(run_stalled.SESSION_UNFINISHED)
		expect(run_stalled.next_step(CHILD)).toContain('fix the cause, then use')
	})
})
