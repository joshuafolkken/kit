import { epic_rank } from '#scripts/epic/epic-rank'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PinnedIssue } from './run-board-pinned-graphql'
import { run_board_watch_rank } from './run-board-watch-rank'
import { run_board_watch_rank_fixture } from './run-board-watch-rank-fixture'

// joshuafolkken/kit#8631: the watch panel shows pinned, then critical, then high, the first three, each
// priority in `epic_rank.rank`'s order and an issue already shown once.

const { watch_rows } = run_board_watch_rank
const { issue_node } = run_board_watch_rank_fixture
const REPO = 'joshuafolkken/kit'
const CLOSED_MS = Date.parse('2026-11-22T04:00:00Z')
const DEFECT_BODY = '## 背景\n\n- 種別: 不具合\n'

function pin(number: number): PinnedIssue {
	return { number, is_closed: false, closed_ms: undefined }
}

function numbers(rows: ReadonlyArray<PinnedIssue>): Array<number> {
	return rows.map((row) => row.number)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_watch_rank.watch_rows', () => {
	it('shows no priority issue when three are pinned', () => {
		const rows = watch_rows([pin(1), pin(2), pin(3)], [[issue_node(10)], [issue_node(20)]], REPO)

		expect(numbers(rows)).toStrictEqual([1, 2, 3])
	})

	it('fills all three rows with critical, then high, when nothing is pinned', () => {
		const rows = watch_rows([], [[issue_node(10)], [issue_node(20), issue_node(21)]], REPO)

		expect(rows).toStrictEqual([pin(10), pin(20), pin(21)])
	})

	it('shows one pin, one critical and the top high', () => {
		const high = [issue_node(20), issue_node(21), issue_node(22)]
		const rows = watch_rows([pin(1)], [[issue_node(10)], high], REPO)

		expect(numbers(rows)).toStrictEqual([1, 10, 20])
	})

	it('orders one priority by epic_rank.rank', () => {
		const rank = vi.spyOn(epic_rank, 'rank')
		const high = [issue_node(20), issue_node(21, DEFECT_BODY)]
		const rows = watch_rows([], [[], high], REPO)

		expect(rank).toHaveBeenCalledTimes(2)
		expect(numbers(rows)).toStrictEqual(numbers(rank.mock.results[1]?.value ?? []))
		expect(numbers(rows)).toStrictEqual([21, 20])
	})

	it('shows a pinned critical issue once, as its pin', () => {
		const rows = watch_rows([pin(10)], [[issue_node(10), issue_node(11)], [issue_node(11)]], REPO)

		expect(numbers(rows)).toStrictEqual([10, 11])
	})

	it('keeps a closed pin as read', () => {
		const closed = { number: 1, is_closed: true, closed_ms: CLOSED_MS }
		const rows = watch_rows([closed], [[issue_node(10)], []], REPO)

		expect(rows).toStrictEqual([closed, pin(10)])
	})
})
