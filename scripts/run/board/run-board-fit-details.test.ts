import { describe, expect, it } from 'vitest'
import {
	run_board_fit,
	type DetailPart,
	type FrameParts,
	type NotesPart,
	type PlanLine,
} from './run-board-fit'

// joshuafolkken/kit#4171: the 🖥 section's parts give way after the rows under the notes and before any
// note, its groups kept.

const { fit, whole } = run_board_fit
const HEADER = ['state', 'clock']
const WIDE = 80
const ROW: PlanLine = { text: '  1', row: { stage: 'running', at_ms: 1 } }
const PROCESSES: DetailPart = {
	head: ['', 'P'],
	lines: [
		{ text: '  ▶ run', is_detail: false },
		{ text: '    🧭 supervisor', is_detail: true },
		{ text: '    🛤 lanes', is_detail: true },
		{ text: '  🌐 apps', is_detail: false },
		{ text: '    Chrome', is_detail: true },
	],
}
const NOTES: NotesPart = { head: ['', 'N'], lines: ['  new', '  old'], hidden: 0 }
const WAVE_ROW: PlanLine = { text: '  7', row: { stage: 'pending', at_ms: undefined } }
const PARTS: FrameParts = {
	above: HEADER,
	plan: [{ head: [''], lines: [ROW] }],
	processes: PROCESSES,
	notes: NOTES,
	below: [{ head: ['', 'W'], lines: [WAVE_ROW] }],
	legend: ['', 'legend'],
	footer: [],
}
const GROUPS = ['', 'P', '  ▶ run', '  🌐 apps']
const LEGEND_ROWS = 2

function fitted(rows: number): Array<string> {
	return fit(PARTS, { columns: WIDE, rows })
}

describe('run_board_fit.fit processes', () => {
	it('draws the section between the plan and the notes while the pane holds it', () => {
		const lines = whole(PARTS)

		expect(lines.indexOf('P')).toBeGreaterThan(lines.indexOf('  1'))
		expect(lines.indexOf('P')).toBeLessThan(lines.indexOf('N'))
		expect(fitted(lines.length)).toStrictEqual(lines)
	})

	it('cuts the rows not yet started first, keeping every part', () => {
		const lines = fitted(whole(PARTS).length - LEGEND_ROWS - 1)

		expect(lines).not.toContain('W')
		expect(lines).toContain('    Chrome')
	})

	it('cuts the parts of each group next, before any note, keeping the groups', () => {
		const kept = [...HEADER, '', '  1', '  more 1', ...GROUPS, ...NOTES.head, '  new', '  old']

		expect(fitted(kept.length)).toStrictEqual(kept)
	})
})
