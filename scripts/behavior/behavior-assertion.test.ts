import type { TranscriptLine } from '#scripts/time-runtime/time-transcript-line'
import { describe, expect, it } from 'vitest'
import { behavior_assertion, type Assertion, type Finding } from './behavior-assertion'
import { behavior_test_fixture } from './behavior-test-fixture'

const SESSION = 'session-abc'
const EVERY = 'every-line'
const { bash_line, GIT_STATUS } = behavior_test_fixture

// A rule that flags every line, used to exercise the engine independent of the real assertions: the
// engine's job is the walk and the stamping, not what any one rule decides.
function every_line_rule(): Assertion {
	return {
		name: EVERY,
		describe: 'flags every parsed line',
		scan: (lines: ReadonlyArray<TranscriptLine>): ReadonlyArray<Finding> =>
			lines.map((_line, index) => ({ assertion: EVERY, position: index + 1, detail: 'x' })),
	}
}

describe('behavior_assertion.parse_transcript', () => {
	it('drops lines that do not parse and keeps the rest in order', () => {
		const text = ['not json', bash_line(GIT_STATUS), '', bash_line('ls')].join('\n')

		const lines = behavior_assertion.parse_transcript(text)

		expect(lines).toHaveLength(2)
	})
})

describe('behavior_assertion.check_lines', () => {
	it('stamps every finding with the session it was read from', () => {
		const lines = behavior_assertion.parse_transcript(bash_line('a'))

		const violations = behavior_assertion.check_lines(lines, SESSION, [every_line_rule()])

		expect(violations).toEqual([
			{ assertion: EVERY, position: 1, detail: 'x', session_id: SESSION },
		])
	})

	it('collects the findings of every assertion', () => {
		const lines = behavior_assertion.parse_transcript(bash_line('a'))

		const violations = behavior_assertion.check_lines(lines, SESSION, [
			every_line_rule(),
			every_line_rule(),
		])

		expect(violations).toHaveLength(2)
	})
})

describe('behavior_assertion.check_transcript', () => {
	it('reports no violation when no rule fires', () => {
		const text = [bash_line(GIT_STATUS), bash_line('ls')].join('\n')

		const violations = behavior_assertion.check_transcript(text, SESSION, [])

		expect(violations).toEqual([])
	})

	it('reports the 1-based position of the offending turn', () => {
		const text = [bash_line('ls'), bash_line(GIT_STATUS)].join('\n')

		const violations = behavior_assertion.check_transcript(text, SESSION, [every_line_rule()])

		expect(violations.map((violation) => violation.position)).toEqual([1, 2])
	})
})
