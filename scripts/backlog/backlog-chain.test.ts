import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { backlog_chain } from './backlog-chain'
import { backlog_fixture } from './backlog-fixture'
import { backlog_overlap } from './backlog-overlap'

// joshuafolkken/kit#8572: the longest serial chain through a wave plan — blocked-by links and
// declared-path overlaps — is the floor on the run's length that more lanes cannot shorten.

const { REPO } = backlog_fixture
const SHARED_PATH = 'scripts/run/board/run-board.ts'
const NO_DECLARED = backlog_overlap.declared_of([])

function child(number: number, blocked_by: ReadonlyArray<number> = []): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [RUN_LANE_LABEL],
		blocked_by: blocked_by.map((blocker) => ({ repo: REPO, number: blocker, state: 'OPEN' })),
	}
}

function sharing(numbers: ReadonlyArray<number>): ReturnType<typeof backlog_overlap.declared_of> {
	return backlog_overlap.declared_of(
		numbers.map((number) => ({ number, body: `Edit \`${SHARED_PATH}\`.` })),
	)
}

function numbers_of(chain: ReadonlyArray<EpicChild>): Array<number> {
	return chain.map((entry) => entry.number)
}

describe('backlog_chain.longest_chain', () => {
	it('follows the same-file overlaps, then a blocked-by link, past an unlinked issue', () => {
		const waves = [[child(1), child(9)], [child(2)], [child(3)], [child(4, [3])]]
		const chain = backlog_chain.longest_chain(waves, sharing([1, 2, 3]))

		expect(numbers_of(chain)).toStrictEqual([1, 2, 3, 4])
	})

	it('finds no chain longer than one issue when nothing is linked', () => {
		const waves = [[child(1), child(2)], [child(3)]]

		expect(backlog_chain.longest_chain(waves, NO_DECLARED)).toHaveLength(1)
	})

	it('picks the smaller issue number between two chains starting in one wave', () => {
		const waves = [
			[child(20), child(10)],
			[child(21, [20]), child(11, [10])],
		]

		expect(numbers_of(backlog_chain.longest_chain(waves, NO_DECLARED))).toStrictEqual([10, 11])
	})

	it('picks the chain starting in the earlier wave over a smaller issue number', () => {
		const waves = [[child(30)], [child(40, [30]), child(5)], [child(6, [5])]]

		expect(numbers_of(backlog_chain.longest_chain(waves, NO_DECLARED))).toStrictEqual([30, 40])
	})
})

describe('backlog_chain.chain_lines', () => {
	it('names the chain in order with its length', () => {
		const lines = backlog_chain.chain_lines([child(1), child(2), child(3)], REPO)
		const references = [1, 2, 3].map((number) => backlog_fixture.cite(number))

		expect(lines).toStrictEqual([
			`${backlog_chain.CHAIN_LABEL} 3 — ${references.join(backlog_chain.ARROW)}`,
		])
	})

	it('prints no line for a chain of one issue or none', () => {
		expect(backlog_chain.chain_lines([child(1)], REPO)).toStrictEqual([])
		expect(backlog_chain.chain_lines([], REPO)).toStrictEqual([])
	})
})
