import type { EpicChild } from '#scripts/epic/epic-graph'
import { issue_publication } from '#scripts/issue/issue-publication'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const child_mock = vi.hoisted(() => vi.fn<(number: number, repo: string) => Promise<EpicChild>>())
const listing_mock = vi.hoisted(() => vi.fn<(issue: string) => Promise<ReadonlyArray<number>>>())
const branch_mock = vi.hoisted(() => vi.fn<() => Promise<string>>())
const REPO = vi.hoisted(() => 'joshuafolkken/kit')

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
	publish_mock.mockReset().mockResolvedValue()
	branch_mock.mockReset().mockResolvedValue(`${String(LANE)}-lane`)
})

describe('run_ship_prepared_children.problems — a child the lane filed', () => {
	it('publishes the epic of a planned child the lane filed', async () => {
		row(CHILD, prepared(LANE), [PLANNED])

		expect(await run_ship_prepared_children.problems()).toStrictEqual([])
		expect(publish_mock).toHaveBeenCalledExactlyOnceWith(EPIC, REPO)
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
		expect(publish_mock).toHaveBeenCalledExactlyOnceWith(LANE, REPO)
	})
})

describe('run_ship_prepared_children.problems — nothing the lane filed', () => {
	it('leaves alone a prepared child filed from another Issue or outside a lane', async () => {
		row(CHILD, prepared(LANE + 1))

		expect(await run_ship_prepared_children.problems()).toStrictEqual([])
		expect(publish_mock).not.toHaveBeenCalled()
	})

	it('passes a lane that filed no prepared child, as before', async () => {
		row(CHILD, '## 概要\n\nPublished.')

		expect(await run_ship_prepared_children.problems()).toStrictEqual([])
		expect(publish_mock).not.toHaveBeenCalled()
	})

	it('asks nothing on a branch with no Issue number', async () => {
		branch_mock.mockResolvedValue('main')

		expect(await run_ship_prepared_children.problems()).toStrictEqual([])
		expect(child_mock).not.toHaveBeenCalled()
	})
})
