import { stripVTControlCharacters } from 'node:util'
import { issue_outcome } from '#scripts/issue/issue-outcome'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_layout, type BoardPlan } from './run-board-layout'
import { run_board_link } from './run-board-link'
import { run_board_pause } from './run-board-pause'
import run_board_pause_fixture from './run-board-pause-fixture.json' with { type: 'json' }
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemStatus } from './run-board-status'

const { NOW, STARTED, header } = run_board_render_fixture
const ISSUE = 7387
const URL = 'https://github.com/joshuafolkken/kit/issues/7387#issuecomment-6818874860'
const SUMMARY = 'Approval needed: defer impact study'
const DECISION = 'needs-decision'
const WIDTH = 120
const PLAN: BoardPlan = {
	pause_reasons: new Map([[ISSUE, { summary: SUMMARY, url: URL, at_ms: NOW }]]),
	waves: { waves: [], unreached: [] },
	tracked: new Map(),
	labels: new Map(),
	context: {
		repo: 'joshuafolkken/kit',
		titles: new Map([[ISSUE, 'Overlap CI safely']]),
		open_numbers: new Set([ISSUE]),
	},
}

function osc8(text: string, url: string): string {
	return `\u{1B}]8;;${url}\u{7}${text}\u{1B}]8;;\u{7}`
}

function render_of(
	plan: BoardPlan,
	status: ItemStatus,
	columns: number,
	is_linked: boolean,
): string {
	const layout = run_board_layout.layout_of(plan, new Map([[ISSUE, status]]))
	const link = is_linked ? osc8 : (text: string): string => text
	const links = run_board_link.links_of(PLAN.context.repo, link)
	const lines = run_board_render.render({
		header: header({ layout, ...links }),
		notes: [],
		size: { columns, rows: WIDTH },
	})

	return lines.find((line) => stripVTControlCharacters(line).includes(String(ISSUE))) ?? ''
}

function line_of(status: ItemStatus, columns = WIDTH, is_linked = true): string {
	return render_of(PLAN, status, columns, is_linked)
}

describe('run_board_render pause reasons', () => {
	it.each([WIDTH, 65])('fits then links the visible pause reason at %s columns', (columns) => {
		const status: ItemStatus = { state: 'parked', started_ms: STARTED }
		const linked = line_of(status, columns)
		const plain = line_of(status, columns, false)
		const visible = stripVTControlCharacters(linked)
		const tail = visible.split('  ').at(-1)?.trim() ?? ''

		expect(linked).toContain(osc8(tail, URL))
		expect(visible).toBe(stripVTControlCharacters(plain))
		expect(run_board_fit.width_of(visible)).toBeLessThanOrEqual(columns)
		expect(plain).not.toContain(URL)
		expect(visible.split('\n')).toHaveLength(1)
	})

	it('keeps decision classification while showing the linked short reason', () => {
		expect(line_of({ state: 'parked', reason: DECISION })).toContain(osc8(SUMMARY, URL))
		expect(stripVTControlCharacters(line_of({ state: 'parked', reason: DECISION }))).toContain('🙋')
	})

	it('clears old evidence on resume and on a new attempt', () => {
		expect(line_of({ state: 'running' })).not.toContain(SUMMARY)
		const next: ItemStatus = { state: 'parked', reason: DECISION, launched_ms: NOW + 1 }

		expect(line_of(next)).not.toContain(URL)
		expect(line_of(next)).toContain('Reason unavailable: inspect issue')
	})
})

const REAL_CASES = [
	{
		...run_board_pause_fixture.parked,
		summary: 'Approve landing-test scope or keep paused',
		reason: undefined,
	},
	{
		...run_board_pause_fixture.decision,
		summary: 'Inspect stale cut and lane before resuming',
		reason: DECISION,
	},
]

describe('run_board_render real stops without markers', () => {
	it.each(REAL_CASES)('renders the current action with its raw evidence: $summary', (fixture) => {
		const stop = {
			author: 'owner',
			body: fixture.body,
			html_url: fixture.url,
			created_at: fixture.createdAt,
			is_trusted: true,
		}
		const recorded = {
			...stop,
			body: issue_outcome.body_of({
				body: '停止説明の補完',
				summary: fixture.summary,
				url: fixture.url,
			}),
		}
		const record = run_board_pause.from_comments([stop, recorded])
		const plan = { ...PLAN, pause_reasons: new Map([[ISSUE, record]]) }
		const status: ItemStatus = { state: 'parked', reason: fixture.reason }
		const linked = render_of(plan, status, WIDTH, true)

		expect(linked).toContain(osc8(fixture.summary, fixture.url))
		expect(stripVTControlCharacters(linked)).toBe(render_of(plan, status, WIDTH, false))
		expect(linked).not.toContain('defer impact study')
		expect(linked).not.toContain('Size approval')
	})
})
