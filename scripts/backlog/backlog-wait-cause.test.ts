import { epic_cross_repo } from '#scripts/epic/epic-cross-repo'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_wait_cause } from './backlog-wait-cause'

// joshuafolkken/kit#4513: a blocked wait is split into the dependency chain and the start condition,
// with the issues each waited on, so `lane:stats` rows them apart.

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/other'
const FUTURE_DATE = '2999-01-01T00:00Z'
const FUTURE_BODY = '## 背景\n\n- 実施可能日: 2999-01-01T00:00Z\n'
const IN_PROGRESS = 'in-progress'

function child(number: number, overrides: Partial<EpicChild> = {}): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [], blocked_by: [], ...overrides }
}

const BLOCKER = { number: 1, repo: REPO }

const NONE = { chain: [], gate: [], publication: [], lane: [] }
const PENDING_BODY = issue_publication_state.prepare('## 背景\n', ['run:lane'])

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_wait_cause.classify', () => {
	it('splits waiting children into the dependency chain and the start condition', () => {
		const children = [
			child(10, { blocked_by: [BLOCKER] }),
			child(11, { body: FUTURE_BODY, blocked_by: [BLOCKER] }),
			child(12, { labels: [IN_PROGRESS], blocked_by: [BLOCKER] }),
			child(13),
			child(14, { repo: OTHER_REPO, blocked_by: [BLOCKER] }),
		]

		expect(backlog_wait_cause.classify(children, REPO)).toStrictEqual({
			...NONE,
			chain: [10],
			gate: [11],
			lane: [13],
			not_before_ms: Date.parse(FUTURE_DATE),
		})
	})

	it('reads a child whose blockers have all closed as no chain wait', () => {
		const children = [
			child(15, { blocked_by: [{ ...BLOCKER, state: 'CLOSED' }] }),
			child(16, { labels: ['In-Progress'], blocked_by: [BLOCKER] }),
			child(17, {
				blocked_by: [
					{ ...BLOCKER, state: 'CLOSED' },
					{ ...BLOCKER, number: 2 },
				],
			}),
		]

		expect(backlog_wait_cause.classify(children, REPO)).toStrictEqual({
			...NONE,
			chain: [17],
			lane: [15],
		})
	})
})

// joshuafolkken/kit#7572: a child whose filing has not published read as a running-lane wait.
describe('backlog_wait_cause.classify — a publication wait', () => {
	it('names a child whose filing has not published as a publication wait, not a lane one', () => {
		const children = [
			child(20, { body: PENDING_BODY }),
			child(21, { body: `${PENDING_BODY}${FUTURE_BODY}`, blocked_by: [BLOCKER] }),
		]
		const causes = backlog_wait_cause.classify(children, REPO)

		expect(causes).toStrictEqual({ ...NONE, publication: [20, 21] })
		expect(backlog_wait_cause.lines_of(causes)).toStrictEqual(['Waiting on publication: #20 #21'])
	})
})

// A closed blocker in another repository still holds the chain until its release publishes.
describe('backlog_wait_cause.classify — a cross-repo blocker', () => {
	it('reads a closed cross-repo blocker whose release has not published as a chain wait', () => {
		vi.spyOn(epic_cross_repo, 'resolve_cross_repo').mockImplementation((blocker) =>
			blocker.repo === OTHER_REPO ? 'time' : 'resolved',
		)
		const children = [
			child(18, { blocked_by: [{ number: 3, repo: OTHER_REPO, state: 'CLOSED' }] }),
			child(19, { blocked_by: [{ ...BLOCKER, state: 'CLOSED' }] }),
		]

		expect(backlog_wait_cause.classify(children, REPO)).toStrictEqual({
			...NONE,
			chain: [18],
			lane: [19],
		})
	})
})

// joshuafolkken/kit#7307: a gate-free candidate the overlap separation withheld beside a dated sibling
// read as the sibling's `gate` alone, and the hold listed only the sibling.
describe('backlog_wait_cause.classify — a running-lane wait', () => {
	it('names a gate-free child withheld beside a dated one as a running-lane wait', () => {
		const causes = backlog_wait_cause.classify(
			[child(7303), child(7228, { body: FUTURE_BODY })],
			REPO,
		)

		expect(backlog_wait_cause.tag_of(causes)).toBe('gate+lane')
		expect(backlog_wait_cause.numbers_of(causes)).toStrictEqual([7228, 7303])
	})
})

describe('backlog_wait_cause — the stderr line round trip', () => {
	it('carries the nearest deadline and excludes running and foreign children', () => {
		const children = [
			child(10, { body: FUTURE_BODY }),
			child(11, { body: FUTURE_BODY.replace('2999', '2998') }),
			child(12, { body: FUTURE_BODY.replace('2999', '2997'), labels: [IN_PROGRESS] }),
			child(13, { body: FUTURE_BODY.replace('2999', '2996'), repo: OTHER_REPO }),
		]
		const causes = backlog_wait_cause.classify(children, REPO)

		expect(causes.not_before_ms).toBe(Date.parse('2998-01-01T00:00Z'))
		expect(backlog_wait_cause.parse(backlog_wait_cause.lines_of(causes).join('\n'))).toStrictEqual(
			causes,
		)
	})

	it('reads back the issues the lines name, linkified or not', () => {
		const causes = { chain: [10, 12], gate: [11], publication: [14], lane: [13] }
		const text = ['explanation', ...backlog_wait_cause.lines_of(causes)].join('\n')
		const linked = text.replace('#11', '[#11](https://github.com/o/r/issues/11)')

		expect(backlog_wait_cause.parse(linked)).toStrictEqual(causes)
	})

	it('writes no line for an empty cause and parses an unrelated text as empty', () => {
		expect(backlog_wait_cause.lines_of(NONE)).toStrictEqual([])
		expect(backlog_wait_cause.parse('#12 is blocked by #11.')).toStrictEqual(NONE)
	})
})

describe('backlog_wait_cause.tag_of and numbers_of', () => {
	it.each([
		[{ ...NONE, chain: [10] }, 'chain'],
		[{ ...NONE, gate: [11] }, 'gate'],
		[{ ...NONE, chain: [10], gate: [11] }, 'chain+gate'],
		[{ ...NONE, gate: [11], lane: [12] }, 'gate+lane'],
		[{ ...NONE, publication: [13], lane: [12] }, 'publication+lane'],
		[NONE, undefined],
	])('tags %j as %s', (causes, tag) => {
		expect(backlog_wait_cause.tag_of(causes)).toBe(tag)
	})

	it('lists the chain, gate, publication and running-lane issues in that order', () => {
		const causes = { chain: [10], gate: [11], publication: [13], lane: [12] }

		expect(backlog_wait_cause.numbers_of(causes)).toStrictEqual([10, 11, 13, 12])
	})
})

describe('backlog_wait_cause.causes_of_tag', () => {
	it.each([
		['lane', ['lane']],
		['chain+gate+lane', ['chain', 'gate', 'lane']],
		['solo', undefined],
		['gate+other', undefined],
	])('reads %s as %j', (tag, causes) => {
		expect(backlog_wait_cause.causes_of_tag(tag)).toStrictEqual(causes)
	})
})
