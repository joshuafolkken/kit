import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { filings_tail } from './delivered-rules-fixture'
import { issue_fold } from './issue-fold'

// joshuafolkken/kit#2213: the fold gate stands down on the first filing (nothing to fold with) and on
// a run that has already folded; only the second-or-later filing of an unfolded run is left for it.

const A_CALL = { name: 'Bash', input: { command: '' } }
const FOLD_COMMAND = 'pnpm josh issue:fold "a" "b"'

// A scouted tail carrying one prior filing, then a `pnpm josh issue:fold` call after it.
function folded_tail(): string {
	return [
		filings_tail(1),
		time_transcript_fixture.josh_call_line(9, time_transcript_fixture.BRANCH, FOLD_COMMAND),
	].join('\n')
}

describe('runs_the_fold', () => {
	it('reads a fold call, segment-wise', () => {
		expect(issue_fold.runs_the_fold(FOLD_COMMAND)).toBe(true)
	})

	it('reads the fold call in its alias spelling', () => {
		expect(issue_fold.runs_the_fold('pnpm josh isf "a" "b"')).toBe(true)
	})

	it('does not read a fold spelling quoted inside a filing body', () => {
		expect(issue_fold.runs_the_fold('gh issue create --title "run pnpm josh issue:fold"')).toBe(
			false,
		)
	})
})

describe('already_folded — the stand-down', () => {
	it('stands down on the first filing, with no earlier filing on the tail', () => {
		expect(issue_fold.already_folded(filings_tail(0), A_CALL)).toBe(true)
	})

	it('does not stand down on a second filing the run has not folded', () => {
		expect(issue_fold.already_folded(filings_tail(1), A_CALL)).toBe(false)
	})

	it('stands down once the run has folded', () => {
		expect(issue_fold.already_folded(folded_tail(), A_CALL)).toBe(true)
	})
})
