import { stripVTControlCharacters } from 'node:util'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import {
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
} from '#scripts/issue/issue-labels'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_fixture } from './run-board-fixture'
import { run_board_human_merge } from './run-board-human-merge'
import { run_board_layout, type BoardPlan, type BoardRow } from './run-board-layout'
import { run_board_link } from './run-board-link'
import { run_board_reason } from './run-board-reason'
import { run_board_render_condition } from './run-board-render-condition'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_tick } from './run-board-tick'

const ISSUE = 6221
const PR = 6225
const READ_FAILED = 'read failed'
const MERGE_TAIL = '→ merge PR #6225'
const FIND_TAIL = '→ find its PR for #6221'
const REPO = 'joshuafolkken/kit'
const LABELS = [IN_PROGRESS_LABEL, NEEDS_HUMAN_MERGE_LABEL]
const CHILD: EpicChild = {
	number: ISSUE,
	repo: REPO,
	state: 'OPEN',
	labels: LABELS,
	blocked_by: [],
}

function plan_of(labels: ReadonlyArray<string> = LABELS): BoardPlan {
	return {
		waves: { waves: [], unreached: [], running: [{ ...CHILD, labels }] },
		tracked: new Map(),
		context: {
			repo: REPO,
			titles: new Map([[ISSUE, 'Workflow update']]),
			open_numbers: new Set([ISSUE]),
		},
		labels: new Map([[ISSUE, labels]]),
		human_merge_prs: new Map([[ISSUE, PR]]),
	}
}

afterEach(() => vi.restoreAllMocks())

describe('run_board_human_merge open pull requests', () => {
	it('reads paginated open pulls and associates their closing issue', async () => {
		const read = vi.spyOn(git_gh_etag_read, 'read_listing').mockResolvedValue(
			JSON.stringify([
				{ number: PR, body: `closes #${String(ISSUE)}` },
				{ number: 1, body: 'closes #1' },
			]),
		)

		expect(await run_board_human_merge.read_prs(plan_of())).toEqual(new Map([[ISSUE, PR]]))
		expect(read).toHaveBeenCalledWith(
			`repos/${REPO}/pulls?state=open&per_page=100`,
			git_gh_api_path.FULL_PAGE_SIZE,
		)
	})

	it('does not read pulls when the label is removed', async () => {
		const read = vi.spyOn(git_gh_etag_read, 'read_listing')

		expect(await run_board_human_merge.read_prs(plan_of([]))).toEqual(new Map())
		expect(read).not.toHaveBeenCalled()
	})

	it('propagates a failed pull read instead of caching an empty answer', async () => {
		vi.spyOn(git_gh_etag_read, 'read_listing').mockRejectedValue(new Error(READ_FAILED))

		await expect(run_board_human_merge.read_prs(plan_of())).rejects.toThrow(READ_FAILED)
	})
})

function layout_of(plan: BoardPlan): ReturnType<typeof run_board_layout.layout_of> {
	const read = {
		plan,
		statuses: new Map([[ISSUE, { state: 'running' as const }]]),
		events: [],
		free_lanes: 0,
		is_stopped: false,
		now_ms: 0,
	}

	return run_board_layout.layout_of(plan, read.statuses, run_board_reason.reader(read))
}

describe('run board human merge layout', () => {
	it('moves a touched running issue into waiting with its PR number', () => {
		const layout = layout_of(plan_of())

		expect(layout.active).toEqual([])
		expect(layout.queued).toEqual([])
		expect(layout.unreached).toMatchObject([
			{
				number: ISSUE,
				state: 'waiting',
				reason: { icon: '🔏', value: 'PR 6225', tail: MERGE_TAIL },
			},
		])
	})

	it('removes the special wait when the label is removed or the issue closes', () => {
		const plan = plan_of()
		const closed = { ...plan, context: { ...plan.context, open_numbers: new Set<number>() } }

		expect(layout_of(plan_of([])).unreached).toEqual([])
		expect(layout_of(closed).unreached).toEqual([])
	})

	it('handles queued and closed children and an unread PR number', () => {
		const plan = plan_of()
		const queued = {
			...plan,
			human_merge_prs: undefined,
			waves: { waves: [[CHILD]], unreached: [] },
		}
		const closed = {
			...queued,
			waves: { waves: [[{ ...CHILD, state: 'CLOSED' as const }]], unreached: [] },
		}

		expect(layout_of(queued).unreached[0]?.reason).toEqual({ icon: '🔏', value: undefined })
		expect(layout_of(closed).unreached).toEqual([])
	})
})

describe('run board human merge actions', () => {
	it('tells the person to find the PR when the read listing holds none for the issue', () => {
		const plan = { ...plan_of(), human_merge_prs: new Map<number, number>() }

		expect(layout_of(plan).unreached[0]?.reason).toEqual({
			icon: '🔏',
			value: undefined,
			tail: FIND_TAIL,
		})
	})
})

async function rendered(plan: BoardPlan, form: 'chat' | 'screen'): Promise<Array<string>> {
	const { LOCAL, harness } = run_board_fixture
	const { ports, frames } = harness(LOCAL, [plan])

	await run_board_tick.tick(run_board_tick.FRESH_STATE, { ...ports, form })
	const lines = stripVTControlCharacters(frames.at(-1) ?? '').split('\n')

	return lines.filter((line) => line.includes('🔏') || line.includes('🔗 waiting'))
}

describe('run board human merge rows', () => {
	it('keeps a simultaneous decision label in waiting instead of people', () => {
		const layout = layout_of(plan_of([...LABELS, NEEDS_DECISION_LABEL]))

		expect(layout.people).toEqual([])
		expect(layout.unreached[0]?.state).toBe('waiting')
	})

	it.each(['screen', 'chat'] as const)('renders the waiting row and legend in %s', async (form) => {
		const relevant = await rendered(plan_of(), form)

		expect(relevant).toMatchSnapshot()
		expect(relevant.join('\n')).toContain('PR 6225')
		expect(relevant.join('\n')).toContain(MERGE_TAIL)
		expect(relevant.join('\n')).toContain('🔏 human merge')
	})

	it.each(['screen', 'chat'] as const)(
		'renders the find action with no open PR in %s',
		async (form) => {
			const relevant = await rendered({ ...plan_of(), human_merge_prs: new Map() }, form)

			expect(relevant).toMatchSnapshot()
			expect(relevant.join('\n')).toContain(FIND_TAIL)
		},
	)
})

const PULL_URL = 'https://github.com/joshuafolkken/kit/pull/6225'
const NARROW_CUT = 3

function osc_link(text: string, url: string): string {
	return `\u{1B}]8;;${url}\u{7}${text}\u{1B}]8;;\u{7}`
}

const LINKED = run_board_render_fixture.header({
	pull_link: run_board_link.pull_linker(REPO, osc_link),
})
const PLAIN = run_board_render_fixture.header()

function waiting_row(): BoardRow {
	const [row] = layout_of(plan_of()).unreached

	if (row === undefined) throw new Error('no waiting row')

	return row
}

describe('run board human merge pull request links', () => {
	it('links the PR number in the condition column and the tail', () => {
		const row = waiting_row()
		const linked = osc_link(String(PR), PULL_URL)

		expect(run_board_render_condition.condition_of(row, LINKED)).toContain(`PR ${linked}`)
		expect(run_board_render_condition.tail_of(row, 0, LINKED)).toBe(`→ merge PR #${linked}`)
	})

	it('keeps the plain text where the header knows no repository', () => {
		const row = waiting_row()

		expect(run_board_render_condition.condition_of(row, PLAIN).trimEnd()).toBe('PR 6225')
		expect(run_board_render_condition.tail_of(row, 0, PLAIN)).toBe(MERGE_TAIL)
	})

	it('draws the linked PR number in the rendered waiting row', async () => {
		const { LOCAL, harness } = run_board_fixture
		const { ports, frames } = harness(LOCAL, [plan_of()])

		await run_board_tick.tick(run_board_tick.FRESH_STATE, { ...ports, link: osc_link })
		const linked = osc_link(String(PR), PULL_URL)

		expect(frames.at(-1)).toContain(`PR ${linked}`)
		expect(frames.at(-1)).toContain(`→ merge PR #${linked}`)
	})

	it('leaves a cut tail plain, so no escape is cut and its width stays the same', () => {
		const row = waiting_row()
		const cut = run_board_render_condition.tail_of(row, NARROW_CUT, LINKED)

		expect(cut).toBe(run_board_render_condition.tail_of(row, NARROW_CUT, PLAIN))
		expect(stripVTControlCharacters(cut)).toBe(cut)
		expect(run_board_fit.width_of(cut)).toBe(run_board_fit.width_of(MERGE_TAIL) - NARROW_CUT)
	})
})

describe('run board human merge earlier lanes', () => {
	it('draws the waiting issue once while keeping unrelated earlier lanes', () => {
		const earlier = { lanes: [String(ISSUE), '1'], unknown: [String(ISSUE), '2'] }
		const layout = run_board_layout.layout_of(plan_of(), new Map(), undefined, earlier)

		expect(layout.unreached.map((row) => row.number)).toEqual([ISSUE])
		expect(layout.earlier?.map((row) => row.number)).toEqual([1, 2])
	})
})
