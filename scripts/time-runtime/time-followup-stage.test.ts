import { git_followup_stages } from '#scripts/git/git-followup-stages'
import { describe, expect, it } from 'vitest'
import { time_followup_stage } from './time-followup-stage'

const SECOND_MS = 1000
const CHECKS_WAIT_SECONDS = 123.4
const TELEGRAM_SECONDS = 2.1

const NO_LAP_YET = 0

// Printed by the emitter itself rather than typed out here: a hand-written block would be this
// suite's own idea of the format, and the point of the reader is that it tracks the printer.
function block(stages: ReadonlyArray<{ name: string; duration_ms: number }>): string {
	return git_followup_stages.format_stages({ stages: [...stages], last_ms: NO_LAP_YET }).join('\n')
}

describe('time_followup_stage.read_stages', () => {
	it('reads the rows followup printed, in the order it printed them', () => {
		const text = block([
			{ name: git_followup_stages.STAGE.checks_wait, duration_ms: CHECKS_WAIT_SECONDS * SECOND_MS },
			{ name: git_followup_stages.STAGE.telegram, duration_ms: TELEGRAM_SECONDS * SECOND_MS },
		])

		expect(time_followup_stage.read_stages(text)).toEqual([
			{ name: git_followup_stages.STAGE.checks_wait, duration_ms: CHECKS_WAIT_SECONDS * SECOND_MS },
			{ name: git_followup_stages.STAGE.telegram, duration_ms: TELEGRAM_SECONDS * SECOND_MS },
		])
	})

	// The total is the sum of the rows, so reading it would give the table a second source for one
	// number — and the two prefixes differ by one character, which is exactly the collision a scan
	// written by hand would miss.
	it('ignores the total row the same block ends with', () => {
		const text = block([{ name: git_followup_stages.STAGE.merge, duration_ms: SECOND_MS }])

		expect(text).toContain(git_followup_stages.STAGE_TOTAL_PREFIX)
		expect(time_followup_stage.read_stages(text)).toEqual([
			{ name: git_followup_stages.STAGE.merge, duration_ms: SECOND_MS },
		])
	})
})

describe('time_followup_stage.read_stages — rows the alignment could break', () => {
	it('reads a row the harness indented, because the printer indents none', () => {
		const row = `  ${git_followup_stages.STAGE_LINE_PREFIX}${git_followup_stages.STAGE.closes_and_context}  0.5 s`

		expect(time_followup_stage.read_stages(row)).toEqual([
			{ name: git_followup_stages.STAGE.closes_and_context, duration_ms: 0.5 * SECOND_MS },
		])
	})

	it('reads nothing out of a body that carries no stage block', () => {
		expect(time_followup_stage.read_stages('merged PR #1\nall checks passed')).toEqual([])
	})

	// The printer pads the name to a fixed width, so a name that reached that width would leave no gap
	// at all — and a reader splitting on whitespace would take the glued name-and-number for the name
	// and drop the row without saying so.
	it('reads a row whose name is too long for the printer to pad', () => {
		const glued = `${git_followup_stages.STAGE_LINE_PREFIX}a-very-long-stage-name12.5 s`

		expect(time_followup_stage.read_stages(glued)).toEqual([
			{ name: 'a-very-long-stage-name', duration_ms: 12.5 * SECOND_MS },
		])
	})

	// A body the harness truncated mid-row is the common cause, and a zero there would read as a lap
	// that ran and took no time.
	it('drops a row whose duration is not a number', () => {
		const row = `${git_followup_stages.STAGE_LINE_PREFIX}${git_followup_stages.STAGE.completion_and_epic_close}`

		expect(time_followup_stage.read_stages(row)).toEqual([])
	})
})
