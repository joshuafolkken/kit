import { describe, expect, it } from 'vitest'
import {
	run_board_fit,
	type DetailPart,
	type FrameParts,
	type NotesPart,
	type PlanLine,
	type PlanSection,
	type SectionKey,
	type YieldStage,
} from './run-board-fit'
import { run_board_fold } from './run-board-fold'
import { run_board_render_section } from './run-board-render-section'

// joshuafolkken/kit#4172: a live board's sections fold and unfold with one key each; a folded section
// is one ▸ line saying what it holds, and the lines it gave up go to the other sections.

const { KEYS_LINE, bounded, fold_parts, toggled } = run_board_fold
const { columns_rule, heading_lines, keyed } = run_board_render_section
const { width_of } = run_board_fit
const HEADER = ['state']
const WIDE = 80
const RULE_WIDTH = 50
const NONE: ReadonlySet<SectionKey> = new Set()
const ALL: ReadonlyArray<SectionKey> = [
	'usage',
	'lanes',
	'processes',
	'findings',
	'queued',
	'waiting',
	'done',
]
const NO_NOTES: NotesPart = { head: [], lines: [], hidden: 0 }
const LANES = '🧵 lanes'
const QUEUED = '⏳ queued'
const WAITING = '🔗 waiting'
const FINDINGS = '📌 findings'
const PROCESSES = '💻 processes'
const GROUPS = '▶ 1.0 ── 🌐 2.0'
const USAGE = '⛽ usage'
const USAGE_SUMMARY = 'claude 42/68 · codex —/45'

function rows(count: number, stage: YieldStage): Array<PlanLine> {
	return Array.from({ length: count }, (_, index) => ({
		text: `  ${stage} ${String(index + 1)}`,
		row: { stage, at_ms: undefined },
	}))
}

function section(label: string, key: SectionKey, lines: Array<PlanLine>): PlanSection {
	return { head: heading_lines(label), lines, label, key }
}

function parts_of(extra: Partial<FrameParts>): FrameParts {
	return { above: HEADER, plan: [], notes: NO_NOTES, legend: [], footer: [], ...extra }
}

function below_parts(): FrameParts {
	const queued = section(QUEUED, 'queued', rows(6, 'pending'))

	return parts_of({ below: [queued, section(WAITING, 'waiting', rows(2, 'waiting'))] })
}

function shut(label: string, summary: string): string {
	return `▸ ${label} ── ${summary} ──`.padEnd(RULE_WIDTH, '─')
}

// The columns a rule takes before its CPU label.
function before_cpu(rule: string): number {
	return width_of(rule.slice(0, rule.indexOf('💪')))
}

function opened(plan: PlanSection): string {
	return fold_parts(parts_of({ plan: [plan] }), NONE).plan[0]?.head.at(-1) ?? ''
}

describe('run_board_fold.toggled', () => {
	it.each([
		{ key: 'u', section: 'usage' },
		{ key: 'l', section: 'lanes' },
		{ key: 'p', section: 'processes' },
		{ key: 'f', section: 'findings' },
		{ key: 'q', section: 'queued' },
		{ key: 'w', section: 'waiting' },
		{ key: 'd', section: 'done' },
	])('folds $section with $key and unfolds it with $key again', ({ key, section: name }) => {
		const folded = toggled(NONE, key)

		expect([...folded]).toStrictEqual([name])
		expect(toggled(folded, key).size).toBe(0)
	})

	it('folds every section with a, unfolds them all once every one is folded', () => {
		const every = toggled(toggled(NONE, 'q'), 'a')

		expect(every).toStrictEqual(new Set(ALL))
		expect(toggled(every, 'a').size).toBe(0)
	})

	it('leaves a key that names no section as it was', () => {
		const folded = toggled(NONE, 'q')

		expect(toggled(folded, 'x')).toBe(folded)
	})
})

describe('run_board_fold.fold_parts open', () => {
	it('leads an open rule with ▾ and keeps every column label over its cells', () => {
		const rule = columns_rule(LANES, [{ label: '💪 CPU', start: 20 }])
		const marked = opened({
			head: ['', rule],
			lines: rows(1, 'running'),
			label: LANES,
			key: 'lanes',
		})

		expect(marked.startsWith(`▾ ${LANES} ─`)).toBe(true)
		expect(before_cpu(marked)).toBe(before_cpu(rule))
	})

	it('gives a section drawn under a blank line alone a ▾ rule of its own', () => {
		const marked = opened({ head: [''], lines: rows(1, 'running'), label: LANES, key: 'lanes' })

		expect(marked).toBe(`▾ ${LANES} `.padEnd(RULE_WIDTH, '─'))
	})

	it('leaves a section no key folds as it was', () => {
		const decision: PlanSection = { head: heading_lines('🙋 decision'), lines: rows(1, 'decision') }

		expect(fold_parts(parts_of({ plan: [decision] }), new Set(ALL)).plan).toStrictEqual([decision])
	})
})

describe('run_board_fold.fold_parts folded', () => {
	it('folds a section to one ▸ line counting its rows', () => {
		const [queued] = fold_parts(below_parts(), new Set(['queued'])).below ?? []

		expect(queued?.head).toStrictEqual(['', shut(QUEUED, '6')])
		expect(queued?.lines).toStrictEqual([])
	})

	it('counts the findings past the limit on the folded line', () => {
		const notes: NotesPart = { head: heading_lines(FINDINGS), lines: ['  a', '  b'], hidden: 3 }
		const folded = fold_parts(parts_of({ notes: { ...notes, label: FINDINGS } }), new Set(ALL))

		expect(folded.notes.head).toStrictEqual(['', shut(FINDINGS, '5')])
	})

	it('folds no findings when there are none', () => {
		const notes: NotesPart = {
			head: heading_lines(FINDINGS),
			lines: [],
			hidden: 0,
			label: FINDINGS,
		}

		expect(fold_parts(parts_of({ notes }), new Set(ALL)).notes).toStrictEqual(notes)
	})

	it('says each group of the folded processes', () => {
		const processes: DetailPart = {
			head: heading_lines(PROCESSES),
			lines: [{ text: '  ▶ backlogrun', is_detail: false }],
			label: PROCESSES,
			summary: GROUPS,
		}
		const folded = fold_parts(parts_of({ processes }), new Set(ALL)).processes

		expect(folded?.head).toStrictEqual(['', shut(PROCESSES, GROUPS)])
		expect(folded?.lines).toStrictEqual([])
	})
})

describe('run_board_fold.fold_parts usage', () => {
	it('folds the usage gauges to their percents', () => {
		const usage: DetailPart = {
			head: heading_lines(USAGE),
			lines: [{ text: '  claude  42%', is_detail: false }],
			label: USAGE,
			summary: USAGE_SUMMARY,
		}
		const folded = fold_parts(parts_of({ usage }), new Set(['usage'])).usage

		expect(folded?.head).toStrictEqual(['', shut(USAGE, USAGE_SUMMARY)])
		expect(folded?.lines).toStrictEqual([])
	})
})

describe('run_board_fold.fold_parts long summary', () => {
	it('ends a folded line on a rule even where its summary runs past the rule width', () => {
		const summary = GROUPS.repeat(RULE_WIDTH)
		const processes: DetailPart = {
			head: heading_lines(PROCESSES),
			lines: [],
			label: PROCESSES,
			summary,
		}
		const folded = fold_parts(parts_of({ processes }), new Set(ALL)).processes

		expect(folded?.head.at(-1)).toBe(`▸ ${PROCESSES} ── ${summary} ──`)
	})
})

describe('run_board_fold.bounded', () => {
	it('draws a frame as it was where nobody folds anything', () => {
		const parts = below_parts()

		expect(bounded(parts, {})).toStrictEqual(run_board_fit.whole(parts))
	})

	it('gives the lines a folded section freed to the rows the pane had cut', () => {
		const parts = below_parts()
		const size = { rows: 7, columns: WIDE }
		const open = bounded(parts, { size, folded: NONE })

		expect(open.some((line) => line.includes('waiting 1'))).toBe(false)
		expect(bounded(parts, { size, folded: new Set(['queued']) })).toStrictEqual([
			...HEADER,
			'',
			shut(QUEUED, '6'),
			'',
			`▾ ${WAITING} `.padEnd(RULE_WIDTH, '─'),
			'  waiting 1',
			'  waiting 2',
		])
	})
})

describe('run_board_render_section.keyed', () => {
	it('names the key a section folds with', () => {
		const [done] = keyed('done', [{ head: [''], lines: rows(1, 'finished') }])

		expect(done?.key).toBe('done')
	})
})

describe('run_board_fold.KEYS_LINE', () => {
	it('names every key once', () => {
		expect(KEYS_LINE).toBe(' u l p f q w d: fold · a: all · Ctrl-C: quit')
	})
})
