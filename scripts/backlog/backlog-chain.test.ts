import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { backlog_chain } from './backlog-chain'
import { backlog_fixture } from './backlog-fixture'
import { backlog_overlap, type Declared } from './backlog-overlap'

// joshuafolkken/kit#8572: the longest serial chain through a wave plan — blocked-by links and
// declared-path overlaps — is the floor on the run's length that more lanes cannot shorten.

const { REPO } = backlog_fixture
const SHARED_PATH = 'scripts/run/board/run-board.ts'
const OTHER_PATH = 'scripts/run/board/run-board-cli.ts'
const OUTSIDE = 99
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

function declaring(paths: ReadonlyMap<number, ReadonlyArray<string>>): Declared {
	return backlog_overlap.declared_of(
		[...paths].map(([number, each]) => ({
			number,
			body: each.map((path) => `Edit \`${path}\`.`).join(' '),
		})),
	)
}

function sharing(numbers: ReadonlyArray<number>): Declared {
	return declaring(new Map(numbers.map((number) => [number, [SHARED_PATH]])))
}

function numbers_of(chain: ReadonlyArray<EpicChild>): Array<number> {
	return chain.map((entry) => entry.number)
}

describe('backlog_chain.longest_chain', () => {
	it('chains the issues that declare the same file, past an unlinked one', () => {
		const waves = [[child(1), child(9)], [child(2)], [child(3)]]
		const chain = backlog_chain.longest_chain(waves, sharing([1, 2, 3]))

		expect(numbers_of(chain)).toStrictEqual([1, 2, 3])
	})

	it('chains blocked-by through a middle issue, past a blocker outside the plan', () => {
		const waves = [[child(1)], [child(2, [1])], [child(3, [2, OUTSIDE])]]

		expect(numbers_of(backlog_chain.longest_chain(waves, NO_DECLARED))).toStrictEqual([1, 2, 3])
	})

	it('keeps out an issue whose overlap does not reach every member', () => {
		const paths = new Map([
			[1, [SHARED_PATH]],
			[2, [SHARED_PATH, OTHER_PATH]],
			[3, [OTHER_PATH]],
		])
		const chain = backlog_chain.longest_chain(
			[[child(1)], [child(2)], [child(3)]],
			declaring(paths),
		)

		expect(numbers_of(chain)).toStrictEqual([2, 3])
	})

	it('stops where a same-file issue meets only the last member of a blocked-by chain', () => {
		const waves = [[child(1)], [child(2, [1])], [child(3)]]
		const chain = backlog_chain.longest_chain(waves, sharing([2, 3]))

		expect(chain).toHaveLength(2)
	})
})

describe('backlog_chain.longest_chain — no link, and a tie', () => {
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
