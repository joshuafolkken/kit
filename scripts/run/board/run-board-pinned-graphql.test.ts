import { git_gh_transport } from '#scripts/gh/git-gh-transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_pinned_graphql } from './run-board-pinned-graphql'

// joshuafolkken/kit#8606: the repository's pinned issues are read in one GraphQL query and kept as
// their number, state and close time, in GitHub's order.

const { pinned_of, read_pinned } = run_board_pinned_graphql
const REPO = 'joshuafolkken/kit'
const CLOSED_AT = '2026-11-22T04:00:00Z'

interface Node {
	number: number
	state: string
	closedAt?: string
}

function answer(nodes: ReadonlyArray<Node>): string {
	const issues = nodes.map((issue) => ({ issue }))

	return JSON.stringify({ data: { repository: { pinnedIssues: { nodes: issues } } } })
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_pinned_graphql.pinned_of', () => {
	it('keeps each pin in order with its state and close time', () => {
		const text = answer([
			{ number: 12, state: 'OPEN' },
			{ number: 7, state: 'CLOSED', closedAt: CLOSED_AT },
		])

		expect(pinned_of(text)).toStrictEqual([
			{ number: 12, is_closed: false, closed_ms: undefined },
			{ number: 7, is_closed: true, closed_ms: Date.parse(CLOSED_AT) },
		])
	})

	it('answers an empty list when nothing is pinned', () => {
		expect(pinned_of(answer([]))).toStrictEqual([])
	})

	it('answers nothing for no text or an answer of another shape', () => {
		expect(pinned_of(undefined)).toBeUndefined()
		expect(pinned_of(JSON.stringify({ data: {} }))).toBeUndefined()
	})
})

describe('run_board_pinned_graphql.read_pinned', () => {
	it('asks GitHub once for the repository it names', async () => {
		const query = vi
			.spyOn(git_gh_transport, 'query')
			.mockResolvedValue(answer([{ number: 3, state: 'OPEN' }]))

		const pinned = await read_pinned(REPO)

		expect(query).toHaveBeenCalledTimes(1)
		expect(query.mock.calls[0]?.[0].variables).toStrictEqual({
			owner: 'joshuafolkken',
			name: 'kit',
		})
		expect(pinned).toStrictEqual([{ number: 3, is_closed: false, closed_ms: undefined }])
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
