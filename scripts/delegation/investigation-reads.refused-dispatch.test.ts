import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { investigation_reads } from './investigation-reads'

// joshuafolkken/kit#4721: a dispatch a row refused (`investigator-foreground`, `agent-model`) ran no
// unit, so the reads before it still count and it closes no window. Before, any `Agent` span cleared
// the count, so a refused background `investigator` satisfied the guard without a unit ever running.

const { BRANCH, call_line, error_result_line, result_line, ms, target_turn_lines } =
	time_transcript_fixture

const DISPATCH_MINUTE = 20
const RESULT_MINUTE = 23
const NEVER_REFUSED_MS = 0
const AGENT_ID = 'agent-call'
const SUBJECT_FILES = ['scripts/one.ts', 'scripts/two.ts']

function dispatch_text(result: string): string {
	return [
		...target_turn_lines(0, SUBJECT_FILES),
		call_line(DISPATCH_MINUTE, BRANCH, 'Agent', AGENT_ID),
		result,
	].join('\n')
}

describe('investigation_reads.tally_of — a refused dispatch', () => {
	it('keeps the count and closes no window', () => {
		const tally = investigation_reads.tally_of(
			dispatch_text(error_result_line(RESULT_MINUTE, BRANCH, AGENT_ID)),
		)

		expect(tally.pending).toEqual(SUBJECT_FILES.map((file) => investigation_reads.resolved(file)))
		expect(tally.reset_ms).toBe(NEVER_REFUSED_MS)
	})

	it('still clears the count at the dispatch that ran', () => {
		const tally = investigation_reads.tally_of(
			dispatch_text(result_line(RESULT_MINUTE, BRANCH, AGENT_ID)),
		)

		expect(tally.pending).toEqual([])
		expect(tally.reset_ms).toBe(ms(RESULT_MINUTE))
	})
})
