import type { OptedIn } from '#scripts/backlog/backlog-next'
import type { Plan } from '#scripts/backlog/backlog-plan-read'
import { backlog_waves } from '#scripts/backlog/backlog-waves'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_plan, type PlanPorts } from './run-board-plan'

// joshuafolkken/kit#3442: the board drew the whole opted-in backlog whatever the run was asked to do. The
// classification and the wave play-forward are `backlog:next`'s and `backlog_waves`'s own, tested there;
// these stub them to one wave per classified set and pin which set each scope classifies.

const REPO = 'joshuafolkken/kit'
const SINGLE = 3441
const EPIC = 3406
const EPIC_CHILDREN = [3407, 3408]
const POOL = [3412, 3407]

function row(number: number): OpenIssueData {
	return { number, title: `issue ${String(number)}`, createdAt: '2026-10-08T00:00:00Z' }
}

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [], blocked_by: [] }
}

// A named epic classifies into its children, as `backlog:next` expands an epic row.
function expanded(issue: number): ReadonlyArray<number> {
	return issue === EPIC ? EPIC_CHILDREN : [issue]
}

function plan_of(opted_in: OptedIn, exclude: ReadonlyArray<number>): Plan {
	const numbers = opted_in.issues
		.filter((issue) => !exclude.includes(issue.number))
		.flatMap((issue) => expanded(issue.number))

	return {
		result: {
			verdict: 'wait',
			candidates: [],
			waiting: numbers.map((number) => child(number)),
			blocked_on_people: [],
			anomalies: [],
		},
		repo: REPO,
		exclude,
		tracked: new Map(),
		scope: { standalone: new Set(), declared: new Map() },
	}
}

const LISTING = [SINGLE, EPIC, ...POOL].map((number) => row(number))

function ports(): PlanPorts {
	return {
		fetch_open: vi.fn(async () => ({ rows: LISTING, is_capped: false })),
		fetch_opted_in: vi.fn(async () => ({
			kind: 'read' as const,
			issues: POOL.map((number) => row(number)),
			cutoff: 'none' as const,
		})),
		classify: vi.fn(async (opted_in: OptedIn, exclude: ReadonlyArray<number>) =>
			plan_of(opted_in, exclude),
		),
	}
}

function wave_numbers(
	waves: ReadonlyArray<ReadonlyArray<EpicChild>> | undefined,
): Array<Array<number>> {
	return (waves ?? []).map((wave) => wave.map((entry) => entry.number))
}

beforeEach(() => {
	vi.spyOn(backlog_waves, 'build').mockImplementation((result) => ({
		waves: [result.waiting],
		unreached: [],
	}))
})

describe('run_board_plan.read_plan', () => {
	it('draws the one named issue alone for a single --only run', async () => {
		const read = ports()
		const plan = await run_board_plan.read_plan({ issues: [SINGLE], only: true }, read)

		expect(wave_numbers(plan?.waves.waves)).toStrictEqual([[SINGLE]])
		expect(read.fetch_opted_in).not.toHaveBeenCalled()
	})

	it('draws a named epic’s children for an epic --only run', async () => {
		const plan = await run_board_plan.read_plan({ issues: [EPIC], only: true }, ports())

		expect(wave_numbers(plan?.waves.waves)).toStrictEqual([EPIC_CHILDREN])
	})

	it('leads with the named issues and follows with the pool, never drawing one twice', async () => {
		const plan = await run_board_plan.read_plan({ issues: [EPIC], only: false }, ports())

		expect(wave_numbers(plan?.waves.waves)).toStrictEqual([EPIC_CHILDREN, [3412]])
	})

	it('draws the opted-in pool alone when nothing is named', async () => {
		const plan = await run_board_plan.read_plan({ issues: [], only: false }, ports())

		expect(wave_numbers(plan?.waves.waves)).toStrictEqual([POOL])
	})

	// joshuafolkken/kit#3459: the labels a running row is checked against, and none for an unlabelled read.
	it('carries each listed issue’s label names, leaving out a row read without labels', async () => {
		const labelled = { ...row(SINGLE), labels: [{ name: IN_PROGRESS_LABEL }] }
		const listing = { rows: [labelled, row(EPIC)], is_capped: false }
		const read = { ...ports(), fetch_open: vi.fn(async () => listing) }
		const plan = await run_board_plan.read_plan({ issues: [SINGLE], only: false }, read)

		expect(plan?.labels).toStrictEqual(new Map([[SINGLE, [IN_PROGRESS_LABEL]]]))
	})

	it('answers a failed listing read as a failed plan', async () => {
		const read = { ...ports(), fetch_open: vi.fn(async () => undefined) }

		expect(await run_board_plan.read_plan({ issues: [SINGLE], only: true }, read)).toBeUndefined()
	})
})
