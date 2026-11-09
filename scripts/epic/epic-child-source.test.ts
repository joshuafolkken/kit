import { backlog_pool } from '#scripts/backlog/backlog-pool'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_issue_batch_graphql } from '#scripts/gh/git-gh-issue-batch-graphql'
import type { IssueRead } from '#scripts/gh/git-gh-issue-read'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_child_source, type ChildSource } from './epic-child-source'
import { epic_fetch, type EpicSnapshot } from './epic-fetch'

// joshuafolkken/kit#6611: an epic child the listing already returned, or a closed one an earlier
// scan read, is not read again — and the snapshot is the one every child's own read would give.

const REPO = 'joshuafolkken/kit'
const EPIC = 900
const GET_CHILD = 'issue_get_state_and_relations_classified'
const LISTED = 1
const CLOSED = 2
const UNREACHABLE_CHILD = 3
const REFUSED_CHILD = 4
const AUTHOR = { author_association: 'OWNER', user: { login: 'joshuafolkken' } }
const UNREACHABLE = { kind: 'unreadable', reason: 'unreachable', status: undefined } as const
const UNREAD = { kind: 'unreadable', reason: 'rejected', status: 403 } as const
const SEVEN_HOURS_MS = 25_200_000

interface Blockers {
	nodes: Array<{ number: number }>
	totalCount: number
}

// The listed child waits on the closed one only where a case says so.
function blockers_of(is_waiting: boolean): Blockers {
	const nodes = is_waiting ? [{ number: CLOSED }] : []

	return { nodes, totalCount: nodes.length }
}

function child_json(number: number, state: string, is_waiting = false): string {
	return JSON.stringify({
		number,
		state,
		labels: [{ name: 'auto-ok' }],
		blockedBy: blockers_of(is_waiting),
		body: `body of ${String(number)}`,
		...AUTHOR,
	})
}

function listed_row(number: number, is_waiting: boolean): OpenIssueData {
	return {
		number,
		title: `child ${String(number)}`,
		createdAt: '2026-11-01T00:00:00Z',
		labels: [{ name: 'auto-ok' }],
		blockedBy: blockers_of(is_waiting),
		body: `body of ${String(number)}`,
		...AUTHOR,
	}
}

function source_of(numbers: ReadonlyArray<number>, is_waiting = false): ChildSource {
	const rows = numbers.map((number) => listed_row(number, is_waiting))
	const children = backlog_pool.to_children(rows, REPO)

	return { repo: REPO, listed: new Map(children.map((child) => [child.number, child])) }
}

// Child 3 fails on the transport; child 4 is refused unless `is_all_unreachable` makes it fail on
// the transport too.
function stub_reads(is_all_unreachable = false, is_waiting = false): void {
	const answers = new Map<string, unknown>([
		[String(LISTED), { kind: 'read', json: child_json(LISTED, 'OPEN', is_waiting) }],
		[String(CLOSED), { kind: 'read', json: child_json(CLOSED, 'CLOSED') }],
		[String(UNREACHABLE_CHILD), UNREACHABLE],
		[String(REFUSED_CHILD), is_all_unreachable ? UNREACHABLE : UNREAD],
	])

	vi.spyOn(git_gh_command, 'issue_get_body_classified').mockResolvedValue({
		kind: 'read',
		text: [LISTED, CLOSED, UNREACHABLE_CHILD, REFUSED_CHILD]
			.map((number) => `- [ ] #${String(number)}`)
			.join('\n'),
	})
	vi.spyOn(git_gh_command, GET_CHILD).mockImplementation(
		async (number: string) => answers.get(number) as never,
	)
}

// The closed child reads as open from now on; every other read answers as before.
function reopen_closed(): void {
	const read = vi.mocked(git_gh_command[GET_CHILD])
	const before = read.getMockImplementation()
	if (before === undefined) return
	const reopened: IssueRead = { kind: 'read', json: child_json(CLOSED, 'OPEN') }

	read.mockImplementation(async (number: string, scope?: string) =>
		number === String(CLOSED) ? reopened : await before(number, scope),
	)
}

function state_of(snapshot: EpicSnapshot, number: number): string | undefined {
	return snapshot.children.find((child) => child.number === number)?.state
}

function reads_of(number: number): number {
	return vi.mocked(git_gh_command[GET_CHILD]).mock.calls.filter(([read]) => read === String(number))
		.length
}

async function scan(source?: ChildSource): Promise<EpicSnapshot> {
	return await epic_fetch.fetch_epic(EPIC, REPO, REPO, source)
}

beforeEach(() => {
	vi.restoreAllMocks()
	// The children's batched GraphQL read answers nothing, so every read is the REST one counted here.
	vi.spyOn(git_gh_issue_batch_graphql, 'read_many').mockResolvedValue(
		git_gh_issue_batch_graphql.empty_batch(),
	)

	return shared_cache_fixture.isolate_shared_cache(epic_child_source.CLOSED_CACHE)
})

describe('epic_fetch.fetch_epic — children the source already knows', () => {
	it('takes a listed open child from its row without reading it', async () => {
		stub_reads()
		await scan(source_of([LISTED]))

		expect(reads_of(LISTED)).toBe(0)
		expect(reads_of(CLOSED)).toBe(1)
	})

	it.each([
		{ name: 'one refused beside one unreachable', is_all_unreachable: false },
		{ name: 'every failure unreachable', is_all_unreachable: true },
	])('answers the snapshot every read gives — $name', async ({ is_all_unreachable }) => {
		stub_reads(is_all_unreachable)
		const read_all = await scan()
		const first = await scan(source_of([LISTED]))
		const second = await scan(source_of([LISTED]))

		expect(first).toEqual(read_all)
		expect(second).toEqual(read_all)
	})
})

describe('epic_fetch.fetch_epic — closed children kept across scans', () => {
	it('returns a closed child from the cache on the second scan', async () => {
		stub_reads()
		await scan(source_of([]))
		const second = await scan(source_of([]))

		expect(reads_of(CLOSED)).toBe(1)
		expect(second.children.find((child) => child.number === CLOSED)?.state).toBe('CLOSED')
	})

	it('reads a closed child again once its record is past the time it is kept', async () => {
		stub_reads()
		await scan(source_of([]))
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + SEVEN_HOURS_MS)
		await scan(source_of([]))

		expect(reads_of(CLOSED)).toBe(2)
	})

	it('takes a reopened child from the listing over its cached closed record', async () => {
		stub_reads()
		await scan(source_of([]))
		const reopened = await scan(source_of([CLOSED]))

		expect(reopened.children.find((child) => child.number === CLOSED)?.state).toBe('OPEN')
	})

	it('reads every scan an open child not in the listing', async () => {
		stub_reads()
		await scan(source_of([]))
		await scan(source_of([]))

		expect(reads_of(LISTED)).toBe(2)
	})

	it('keeps nothing across scans without a source', async () => {
		stub_reads()
		await scan()
		await scan(source_of([]))

		expect(reads_of(CLOSED)).toBe(2)
	})
})

describe('epic_fetch.fetch_epic — a cached closed child that was reopened', () => {
	it('reads a cached closed child again while an open sibling waits on it', async () => {
		stub_reads(false, true)
		await scan(source_of([LISTED], true))
		reopen_closed()
		const second = await scan(source_of([LISTED], true))

		expect(reads_of(CLOSED)).toBe(2)
		expect(state_of(second, CLOSED)).toBe('OPEN')
	})

	it('drops a reopened child from the record once a read finds it open', async () => {
		stub_reads(false, true)
		await scan(source_of([LISTED], true))
		reopen_closed()
		await scan(source_of([LISTED], true))
		const no_longer_waited = await scan(source_of([LISTED]))

		expect(reads_of(CLOSED)).toBe(3)
		expect(state_of(no_longer_waited, CLOSED)).toBe('OPEN')
	})
})
