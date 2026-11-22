import type { GraphqlIssueFields } from '#scripts/gh/git-gh-issue-graphql'
import { git_gh_transport } from '#scripts/gh/git-gh-transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_pinned_graphql } from './run-board-pinned-graphql'
import { run_board_watch_rank_fixture } from './run-board-watch-rank-fixture'

// joshuafolkken/kit#8606, joshuafolkken/kit#8631: the pinned issues and the open critical and high
// ones are read in one GraphQL query and kept as their number, state and close time.

const { PINNED_QUERY, pinned_of, read_pinned } = run_board_pinned_graphql
const { issue_node } = run_board_watch_rank_fixture
const REPO = 'joshuafolkken/kit'
const CLOSED_AT = '2026-11-22T04:00:00Z'

interface Node {
	number: number
	state: string
	closedAt?: string
}

interface Listings {
	critical?: ReadonlyArray<GraphqlIssueFields>
	high?: ReadonlyArray<GraphqlIssueFields>
}

function answer(nodes: ReadonlyArray<Node>, listings: Listings = {}): string {
	const issues = nodes.map((issue) => ({ issue }))
	const { critical = [], high = [] } = listings
	const repository = {
		pinnedIssues: { nodes: issues },
		critical: { nodes: critical },
		high: { nodes: high },
	}

	return JSON.stringify({ data: { repository } })
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_pinned_graphql.PINNED_QUERY', () => {
	it('reads the pins and both priorities under one repository', () => {
		expect(PINNED_QUERY).toContain('pinnedIssues(first: 3)')
		expect(PINNED_QUERY).toContain('critical: issues(')
		expect(PINNED_QUERY).toContain('labels: ["priority:critical"], states: OPEN')
		expect(PINNED_QUERY).toContain('high: issues(')
		expect(PINNED_QUERY).toContain('labels: ["priority:high"], states: OPEN')
	})
})

describe('run_board_pinned_graphql.pinned_of', () => {
	it('keeps each pin in order with its state and close time', () => {
		const text = answer([
			{ number: 12, state: 'OPEN' },
			{ number: 7, state: 'CLOSED', closedAt: CLOSED_AT },
		])

		expect(pinned_of(text, REPO)).toStrictEqual([
			{ number: 12, is_closed: false, closed_ms: undefined },
			{ number: 7, is_closed: true, closed_ms: Date.parse(CLOSED_AT) },
		])
	})

	it('fills the rows after the pins with critical, then high', () => {
		const text = answer([{ number: 12, state: 'OPEN' }], {
			critical: [issue_node(30)],
			high: [issue_node(40), issue_node(41)],
		})

		expect(pinned_of(text, REPO)?.map((row) => row.number)).toStrictEqual([12, 30, 40])
	})

	it('answers an empty list when nothing is pinned', () => {
		expect(pinned_of(answer([]), REPO)).toStrictEqual([])
	})

	it('answers nothing for no text or an answer of another shape', () => {
		expect(pinned_of(undefined, REPO)).toBeUndefined()
		expect(pinned_of(JSON.stringify({ data: {} }), REPO)).toBeUndefined()
	})
})

describe('run_board_pinned_graphql.read_pinned', () => {
	it('asks GitHub once for the repository it names', async () => {
		const query = vi
			.spyOn(git_gh_transport, 'query')
			.mockResolvedValue(answer([{ number: 3, state: 'OPEN' }], { high: [issue_node(9)] }))

		const pinned = await read_pinned(REPO)

		expect(query).toHaveBeenCalledTimes(1)
		expect(query.mock.calls[0]?.[0].variables).toStrictEqual({
			owner: 'joshuafolkken',
			name: 'kit',
		})
		expect(pinned).toStrictEqual([
			{ number: 3, is_closed: false, closed_ms: undefined },
			{ number: 9, is_closed: false, closed_ms: undefined },
		])
	})

	it('answers nothing when GitHub does not answer', async () => {
		vi.spyOn(git_gh_transport, 'query').mockResolvedValue(undefined)

		expect(await read_pinned(REPO)).toBeUndefined()
	})

	it('asks nothing for a repository it cannot spell', async () => {
		const query = vi.spyOn(git_gh_transport, 'query')

		expect(await read_pinned('not-a-repo')).toBeUndefined()
		expect(query).not.toHaveBeenCalled()
	})
})
