import type { EpicChild } from '#scripts/epic/epic-graph'
import { issue_publication } from '#scripts/issue/issue-publication'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const child_mock = vi.hoisted(() => vi.fn<(number: number, repo: string) => Promise<EpicChild>>())
const listing_mock = vi.hoisted(() => vi.fn<(issue: string) => Promise<ReadonlyArray<number>>>())
const branch_mock = vi.hoisted(() => vi.fn<() => Promise<string>>())
const open_mock = vi.hoisted(() =>
	vi.fn<() => Promise<{ rows: Array<EpicChild>; is_capped: boolean } | undefined>>(),
)
const REPO = vi.hoisted(() => 'joshuafolkken/kit')

vi.mock('#scripts/backlog/backlog-plan-read', () => ({
	backlog_plan_read: { read_open_relations: open_mock },
}))
vi.mock('#scripts/backlog/backlog-pool', () => ({
	backlog_pool: { to_children: (rows: Array<EpicChild>): Array<EpicChild> => rows },
}))
vi.mock('#scripts/epic/epic-live', () => ({ epic_live: { child: child_mock } }))
vi.mock('#scripts/epic/epic-blocked-by', () => ({
	epic_blocked_by: { listing_epics: listing_mock },
}))
vi.mock('#scripts/git/git-branch', () => ({ git_branch: { current: branch_mock } }))
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { repo_get_name_with_owner: vi.fn().mockResolvedValue(REPO) },
}))

const { run_ship_prepared_children } = await import('./run-ship-prepared-children')

// joshuafolkken/kit#8542: the shape of joshuafolkken/kit#8474 — the lane's Issue is a child of an
// epic, files its split children prepared beside it, and ships its own stage without `run:pause`.

const LANE = 8474
const EPIC = 8479
const CHILD = 8512
const OTHER = 8513
const PLANNED = 'run:planned'
const WITHHELD = 'dependencies are not recorded'
const PUBLISHED_BODY = '## 概要\n\nPublished.'
const UNLISTED = 'Cannot list the open Issues'
const rows = new Map<number, EpicChild>()
const publish_mock = vi.spyOn(issue_publication, 'publish')

function row(number: number, body: string, labels: Array<string> = []): void {
	rows.set(number, { number, repo: REPO, state: 'OPEN', body, labels, blocked_by: [] })
}

function prepared(origin: number | undefined): string {
	return issue_publication_state.prepare('## 概要\n\nA split child.', ['run:lane'], origin)
}

function task_list(...numbers: ReadonlyArray<number>): string {
	const lines = numbers.map((number) => `- [ ] #${String(number)}`)

	return ['## Tasks', '', ...lines, ''].join('\n')
}

beforeEach(() => {
	rows.clear()
	row(EPIC, task_list(LANE, CHILD, OTHER))
	row(LANE, '## 概要\n\nThe lane.')
	row(OTHER, prepared(undefined))
	child_mock.mockReset().mockImplementation(async (number) => {
		const found = rows.get(number)
		if (found === undefined) throw new Error(`no #${String(number)}`)

		return await found
	})
	listing_mock.mockReset().mockResolvedValue([EPIC])
	open_mock.mockReset().mockImplementation(async () => {
		return await { rows: [...rows.values()], is_capped: false }
	})
	publish_mock.mockReset().mockResolvedValue()
	branch_mock.mockReset().mockResolvedValue(`${String(LANE)}-lane`)
})

describe('run_ship_prepared_children.problems — a child the lane filed', () => {
	it('publishes the epic of a planned child the lane filed', async () => {
		row(CHILD, prepared(LANE), [PLANNED])

		expect(await run_ship_prepared_children.problems()).toStrictEqual([])
		expect(publish_mock).toHaveBeenCalledExactlyOnceWith(EPIC, REPO, expect.any(Function))
	})

	it('refuses an unplanned child with the plan and publish commands, publishing nothing', async () => {
		row(CHILD, prepared(LANE))

		const [refusal, ...rest] = await run_ship_prepared_children.problems()

		expect(rest).toStrictEqual([])
		expect(refusal).toContain(
			`pnpm josh issue:plan ${String(CHILD)} --body-file … --planned --no-notify`,
		)
		expect(refusal).toContain(`pnpm josh issue:file --publish ${String(EPIC)}`)
		expect(publish_mock).not.toHaveBeenCalled()
	})

	it('stops with the reason when the publish withholds the epic', async () => {
		row(CHILD, prepared(LANE), [PLANNED])
		publish_mock.mockRejectedValue(new Error(WITHHELD))

		const problems = await run_ship_prepared_children.problems()

		expect(problems).toHaveLength(1)
		expect(problems[0]).toContain(WITHHELD)
	})

	it('finds a child the lane Issue itself lists once it became an epic', async () => {
		row(LANE, task_list(CHILD))
		row(CHILD, prepared(LANE), [PLANNED])
		listing_mock.mockResolvedValue([])

		expect(await run_ship_prepared_children.problems()).toStrictEqual([])
		expect(publish_mock).toHaveBeenCalledExactlyOnceWith(LANE, REPO, expect.any(Function))
	})
})

// The unplanned sibling `OTHER` was filed outside the lane: the publish neither validates nor
// publishes it, so it neither withholds this ship nor is published by it.
describe('run_ship_prepared_children.problems — the batch it publishes', () => {
	it('selects only the children the lane filed from the epic it publishes', async () => {
		row(CHILD, prepared(LANE), [PLANNED])
		await run_ship_prepared_children.problems()
		const is_selected = publish_mock.mock.calls[0]?.[2] ?? (() => false)
		const selected = [CHILD, OTHER, LANE].filter((number) => {
			const found = rows.get(number)

			return found !== undefined && is_selected(found)
		})

		expect(selected).toStrictEqual([CHILD])
	})
})

// joshuafolkken/kit#9074: the shape of joshuafolkken/kit#9063 — a child the lane filed before any
// epic of this run listed it, so no task list reaches it.
const ORPHAN = 9063
const SIDE = 9070

// The run's own epic lists only a published `CHILD`, so whatever is found comes from the open listing.
function orphan_epics(epics: ReadonlyArray<number>): void {
	row(CHILD, PUBLISHED_BODY)
	listing_mock.mockImplementation(async (issue) => {
		return await (issue === String(ORPHAN) ? epics : [EPIC])
	})
}

describe('run_ship_prepared_children.problems — a child no epic of the run lists', () => {
	it('refuses a planned child in no epic with the epic and publish commands', async () => {
		row(ORPHAN, prepared(LANE), [PLANNED])
		orphan_epics([])

		const [refusal, ...rest] = await run_ship_prepared_children.problems()

		expect(rest).toStrictEqual([])
		expect(refusal).toContain(`pnpm josh epic "<title>" ${String(ORPHAN)}`)
		expect(refusal).toContain('pnpm josh issue:file --publish <E>')
		expect(publish_mock).not.toHaveBeenCalled()
	})

	it('names the plan command too when the unplaced child has no plan', async () => {
		row(ORPHAN, prepared(LANE))
		orphan_epics([])

		const problems = await run_ship_prepared_children.problems()

		expect(problems).toHaveLength(2)
		expect(problems.join('\n')).toContain(`pnpm josh issue:plan ${String(ORPHAN)}`)
		expect(problems[1]).toContain('`pnpm josh issue:file --publish <E>`, then re-detach the ship')
	})

	it('publishes it through the other epic that lists it', async () => {
		row(SIDE, task_list(ORPHAN))
		row(ORPHAN, prepared(LANE), [PLANNED])
		orphan_epics([SIDE])

		expect(await run_ship_prepared_children.problems()).toStrictEqual([])
		expect(publish_mock).toHaveBeenCalledExactlyOnceWith(SIDE, REPO, expect.any(Function))
	})
})

describe('run_ship_prepared_children.problems — the open Issues it reads', () => {
	it('leaves alone an unlisted child of another run or of no lane', async () => {
		row(ORPHAN, prepared(LANE + 1))
		row(SIDE, prepared(undefined))
		orphan_epics([])

		expect(await run_ship_prepared_children.problems()).toStrictEqual([])
		expect(publish_mock).not.toHaveBeenCalled()
	})

	it('fails rather than passes when the open Issues cannot be listed', async () => {
		open_mock.mockResolvedValue(undefined)

		await expect(run_ship_prepared_children.problems()).rejects.toThrow(UNLISTED)
	})

	it('fails rather than passes when the open Issues listing is capped', async () => {
		open_mock.mockResolvedValue({ rows: [], is_capped: true })

		await expect(run_ship_prepared_children.problems()).rejects.toThrow(UNLISTED)
	})
})

describe('run_ship_prepared_children.problems — nothing the lane filed', () => {
	it('leaves alone a prepared child filed from another Issue or outside a lane', async () => {
		row(CHILD, prepared(LANE + 1))

		expect(await run_ship_prepared_children.problems()).toStrictEqual([])
		expect(publish_mock).not.toHaveBeenCalled()
	})

	it('passes a lane that filed no prepared child, as before', async () => {
		row(CHILD, PUBLISHED_BODY)

		expect(await run_ship_prepared_children.problems()).toStrictEqual([])
		expect(publish_mock).not.toHaveBeenCalled()
	})

	it('asks nothing on a branch with no Issue number', async () => {
		branch_mock.mockResolvedValue('main')

		expect(await run_ship_prepared_children.problems()).toStrictEqual([])
		expect(child_mock).not.toHaveBeenCalled()
	})
})
