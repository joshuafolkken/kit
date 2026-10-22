import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import { backlog_wait_cause } from './backlog-wait-cause'

// joshuafolkken/kit#4513: a blocked wait is split into the dependency chain and the start condition,
// with the issues each waited on, so `lane:stats` rows them apart.

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/other'
const FUTURE_BODY = '## 背景\n\n- 実施可能日: 2999-01-01T00:00Z\n'

function child(number: number, overrides: Partial<EpicChild> = {}): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [], blocked_by: [], ...overrides }
}

const BLOCKER = { number: 1, repo: REPO }

describe('backlog_wait_cause.classify', () => {
	it('splits waiting children into the dependency chain and the start condition', () => {
		const children = [
			child(10, { blocked_by: [BLOCKER] }),
			child(11, { body: FUTURE_BODY, blocked_by: [BLOCKER] }),
			child(12, { labels: ['in-progress'], blocked_by: [BLOCKER] }),
			child(13),
			child(14, { repo: OTHER_REPO, blocked_by: [BLOCKER] }),
		]

		expect(backlog_wait_cause.classify(children, REPO)).toStrictEqual({ chain: [10], gate: [11] })
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

		expect(backlog_wait_cause.classify(children, REPO)).toStrictEqual({ chain: [17], gate: [] })
	})
})

describe('backlog_wait_cause — the stderr line round trip', () => {
	it('reads back the issues the lines name, linkified or not', () => {
		const causes = { chain: [10, 12], gate: [11] }
		const text = ['explanation', ...backlog_wait_cause.lines_of(causes)].join('\n')
		const linked = text.replace('#11', '[#11](https://github.com/o/r/issues/11)')

		expect(backlog_wait_cause.parse(linked)).toStrictEqual(causes)
	})

	it('writes no line for an empty cause and parses an unrelated text as empty', () => {
		expect(backlog_wait_cause.lines_of({ chain: [], gate: [] })).toStrictEqual([])
		expect(backlog_wait_cause.parse('#12 is blocked by #11.')).toStrictEqual({
			chain: [],
			gate: [],
		})
	})
})

describe('backlog_wait_cause.tag_of and numbers_of', () => {
	it.each([
		[{ chain: [10], gate: [] }, 'chain'],
		[{ chain: [], gate: [11] }, 'gate'],
		[{ chain: [10], gate: [11] }, 'chain+gate'],
		[{ chain: [], gate: [] }, undefined],
	])('tags %j as %s', (causes, tag) => {
		expect(backlog_wait_cause.tag_of(causes)).toBe(tag)
	})

	it('lists the chain issues before the gate issues', () => {
		expect(backlog_wait_cause.numbers_of({ chain: [10], gate: [11] })).toStrictEqual([10, 11])
	})
})
