import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { FILING_COMMAND, filings_tail } from './delivered-rules-fixture'
import { filing_cap } from './filing-cap'

// joshuafolkken/kit#2119: the cap's counter, over a run's transcript tail. The delivery — refused at
// the eleventh filing, fired on every one past it — is pinned in `delivered-rules-filing.test.ts`;
// here the count itself is pinned, including that a guard-refused filing is not counted.

const THREE = 3
const ONE_REFUSED = 1
const HELD_MINUTE = 30
const HELD_ID = 'filing-held'
const HELD_CALL_LINE = time_transcript_fixture.tool_call_line(
	HELD_MINUTE,
	time_transcript_fixture.BRANCH,
	{ name: 'Bash', input: { command: FILING_COMMAND }, id: HELD_ID },
)
const HELD_RESULT_LINE = time_transcript_fixture.error_result_line(
	HELD_MINUTE,
	time_transcript_fixture.BRANCH,
	HELD_ID,
	'✖ duplicate candidate(s) 12 not declared separate',
)

describe('prior_filing_count', () => {
	it('counts every filing the tail carries', () => {
		expect(filing_cap.prior_filing_count(filings_tail(THREE))).toBe(THREE)
	})

	it('is zero for a tail with no filing', () => {
		expect(filing_cap.prior_filing_count('')).toBe(0)
	})

	it('does not count a guard-refused filing', () => {
		expect(filing_cap.prior_filing_count(filings_tail(THREE, ONE_REFUSED))).toBe(
			THREE - ONE_REFUSED,
		)
	})

	// joshuafolkken/kit#2808: `issue:file` holding a filing itself exits non-zero with no guard named.
	it('does not count a filing issue:file held without any guard refusing it', () => {
		const tail = [filings_tail(THREE), HELD_CALL_LINE, HELD_RESULT_LINE].join('\n')

		expect(filing_cap.prior_filing_count(tail)).toBe(THREE)
	})
})

// joshuafolkken/kit#2422: the stop guard asks whether *this turn* filed, so a filing before the last
// prompt must not count.
const PROMPT_LINE = JSON.stringify({
	type: 'user',
	timestamp: '2026-09-23T00:00:00.000Z',
	message: { role: 'user', content: 'next task' },
})

describe('turn_filing_count', () => {
	it('counts only the filings after the last prompt', () => {
		const tail = [filings_tail(THREE), PROMPT_LINE, filings_tail(ONE_REFUSED + 1)].join('\n')

		expect(filing_cap.turn_filing_count(tail)).toBe(ONE_REFUSED + 1)
	})

	it('is zero when the filings all precede the last prompt', () => {
		expect(filing_cap.turn_filing_count([filings_tail(THREE), PROMPT_LINE].join('\n'))).toBe(0)
	})

	it('reads the whole tail when no prompt is on it', () => {
		expect(filing_cap.turn_filing_count(filings_tail(THREE))).toBe(THREE)
	})
})
