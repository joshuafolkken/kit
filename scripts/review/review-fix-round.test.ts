import { describe, expect, it } from 'vitest'
import { review_fix_round, type RecordedRound } from './review-fix-round'

const FINDING = {
	category: 'tests',
	severity: 'medium',
	file: 'a.ts:1',
	description: 'Missing boundary check.',
}
const PREVIOUS: RecordedRound = { id: 'first', issue: 6286, snapshot: '{}', findings: [FINDING] }
const CONTINUING = '"status":"continuing"'
const RESOLVED = '"status":"resolved"'
const NEW = '"status":"new"'

function round(findings: RecordedRound['findings']): RecordedRound {
	return { ...PREVIOUS, id: 'next', findings }
}

describe('review_fix_round.correspondence', () => {
	it('links a continuing finding across shifted line numbers with its body', () => {
		const lines = review_fix_round.correspondence(PREVIOUS, round([{ ...FINDING, file: 'a.ts:2' }]))

		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain(CONTINUING)
		expect(lines[0]).toContain('"previous":"first"')
		expect(lines[0]).toContain(FINDING.description)
	})
	it('records resolved and new findings in the same round', () => {
		const lines = review_fix_round.correspondence(
			PREVIOUS,
			round([{ ...FINDING, description: 'Another defect.' }]),
		)

		expect(lines).toHaveLength(2)
		expect(lines[0]).toContain(NEW)
		expect(lines[1]).toContain(RESOLVED)
	})
	it('records an explicit closing disposition as resolved', () => {
		const lines = review_fix_round.correspondence(
			PREVIOUS,
			round([{ ...FINDING, disposition: 'fixed' }]),
		)

		expect(lines[0]).toContain(RESOLVED)
	})
})

describe('review_fix_round correspondence boundaries', () => {
	it('keeps a deferred finding open and never links a different issue', () => {
		const current = round([{ ...FINDING, disposition: 'deferred:#12' }])

		expect(review_fix_round.correspondence(PREVIOUS, current)[0]).toContain(CONTINUING)
		expect(review_fix_round.correspondence({ ...PREVIOUS, issue: 1 }, current)[0]).toContain(NEW)
	})
	it('does not treat ambiguous identical findings as a unique continuation', () => {
		const previous = { ...PREVIOUS, findings: [FINDING, FINDING] }

		expect(review_fix_round.correspondence(previous, round([FINDING]))[0]).toContain(NEW)
	})
})
