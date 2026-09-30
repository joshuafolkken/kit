import { auto_ok_fixture } from '#scripts/auto-ok/auto-ok-fixture'
import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL, RUN_SOLO_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it } from 'vitest'
import { epic_busy, type BusyRead } from './epic-busy'
import type { EpicChild } from './epic-graph'
import { epic_report, type EpicNextResult, type EpicVerdict } from './epic-report'
import { epic_solo } from './epic-solo'

// The `run:solo` gate on `backlog:next`'s offer (joshuafolkken/kit#2776), pinned as a pure function of
// the result and the repository's `in-progress` read.

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const FIRST = 11
const SECOND = 12
const THIRD = 13
const HOLDER = 20
const CREATED = '2026-09-01T00:00:00Z'
const IDLE: BusyRead = { kind: 'idle' }

function child(number: number, labels: ReadonlyArray<string> = [], repo = REPO): EpicChild {
	return { number, repo, state: 'OPEN', labels, blocked_by: [] }
}

function solo(number: number): EpicChild {
	return child(number, [RUN_SOLO_LABEL])
}

function result(children: ReadonlyArray<EpicChild>, verdict: EpicVerdict = 'run'): EpicNextResult {
	return {
		verdict,
		candidates: [
			{ repo: REPO, children },
			{ repo: OTHER_REPO, children: [child(THIRD, [RUN_SOLO_LABEL], OTHER_REPO)] },
		],
		waiting: [],
		blocked_on_people: [],
		anomalies: [],
	}
}

function busy(labels: ReadonlyArray<string>): BusyRead {
	return epic_busy.parse_listing(
		JSON.stringify([auto_ok_fixture.issue(HOLDER, CREATED, [IN_PROGRESS_LABEL, ...labels])]),
		false,
	)
}

function offered(gated: EpicNextResult): ReadonlyArray<number> {
	return epic_report.candidates_for_repo(gated, REPO).map((entry) => entry.number)
}

function waiting(gated: EpicNextResult): ReadonlyArray<number> {
	return gated.waiting.map((entry) => entry.number)
}

describe('epic_solo.gate', () => {
	it('leaves the offer unchanged when no candidate or holder carries run:solo', () => {
		const input = result([child(FIRST), child(SECOND)])

		expect(epic_solo.gate(input, busy([]), REPO)).toStrictEqual({ result: input })
	})

	it('leaves a verdict other than run untouched, whatever the listing says', () => {
		const input = result([solo(FIRST)], 'wait')

		expect(epic_solo.gate(input, { kind: 'unreadable' }, REPO)).toStrictEqual({ result: input })
	})

	it('offers nothing while a running issue carries run:solo', () => {
		const input = result([child(FIRST), child(SECOND)])
		const gated = epic_solo.gate(input, busy([RUN_SOLO_LABEL]), REPO)

		expect(offered(gated.result)).toStrictEqual([])
		expect(waiting(gated.result)).toStrictEqual([FIRST, SECOND])
		expect(gated.notice).toContain(`#${String(HOLDER)}`)
	})

	it('does not count a parked run:solo holder as running', () => {
		const read = busy([RUN_SOLO_LABEL, NEEDS_DECISION_LABEL])
		const gated = epic_solo.gate(result([child(FIRST)]), read, REPO)

		expect(offered(gated.result)).toStrictEqual([FIRST])
	})

	it('matches the label without regard to case', () => {
		const gated = epic_solo.gate(result([child(FIRST)]), busy(['Run:Solo']), REPO)

		expect(offered(gated.result)).toStrictEqual([])
	})
})

describe('epic_solo.gate on a run:solo candidate', () => {
	it('offers a run:solo head alone into an idle repository', () => {
		const gated = epic_solo.gate(result([solo(FIRST), child(SECOND)]), IDLE, REPO)

		expect(offered(gated.result)).toStrictEqual([FIRST])
		expect(waiting(gated.result)).toStrictEqual([SECOND])
		expect(gated.notice).toBeUndefined()
	})

	it('waits rather than offering past a run:solo head while other lanes run', () => {
		const gated = epic_solo.gate(result([solo(FIRST), child(SECOND)]), busy([]), REPO)

		expect(offered(gated.result)).toStrictEqual([])
		expect(waiting(gated.result)).toStrictEqual([FIRST, SECOND])
		expect(gated.notice).toContain(`#${String(FIRST)}`)
	})

	it('offers only the candidates ranked ahead of a later run:solo candidate while lanes run', () => {
		const input = result([child(FIRST), solo(SECOND), child(THIRD)])
		const gated = epic_solo.gate(input, busy([]), REPO)

		expect(offered(gated.result)).toStrictEqual([FIRST])
		expect(waiting(gated.result)).toStrictEqual([SECOND, THIRD])
	})
})

// joshuafolkken/kit#2778: an idle repository takes its first run:solo candidate ahead of the ranking.
describe('epic_solo.gate on a later run:solo candidate', () => {
	it('offers a later run:solo candidate alone, ahead of the ranking, into an idle repository', () => {
		const gated = epic_solo.gate(result([child(FIRST), solo(SECOND), child(THIRD)]), IDLE, REPO)

		expect(offered(gated.result)).toStrictEqual([SECOND])
		expect(waiting(gated.result)).toStrictEqual([FIRST, THIRD])
		expect(gated.notice).toBeUndefined()
	})

	it('offers only the first of two run:solo candidates into an idle repository', () => {
		const gated = epic_solo.gate(result([child(FIRST), solo(SECOND), solo(THIRD)]), IDLE, REPO)

		expect(offered(gated.result)).toStrictEqual([SECOND])
		expect(waiting(gated.result)).toStrictEqual([FIRST, THIRD])
	})

	it.each<BusyRead>([{ kind: 'unreadable' }, { kind: 'truncated' }])(
		'offers nothing when the in-progress listing is $kind',
		(read) => {
			const gated = epic_solo.gate(result([child(FIRST)]), read, REPO)

			expect(offered(gated.result)).toStrictEqual([])
			expect(gated.notice).toContain(IN_PROGRESS_LABEL)
		},
	)

	it('leaves another repository bundle as it was', () => {
		const gated = epic_solo.gate(result([child(FIRST)]), busy([RUN_SOLO_LABEL]), REPO)

		expect(epic_report.candidates_for_repo(gated.result, OTHER_REPO)).toHaveLength(1)
	})
})
