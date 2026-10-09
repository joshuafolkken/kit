import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardNote } from './run-board-notes'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#3430: what the board says below its plan — the findings, the resume command and a
// board with no run.

const { clock_of } = run_board_labels
const { MINUTE, NOW, WORDS, header, lines_of, note, rule } = run_board_render_fixture

describe('run_board_render findings and no run', () => {
	it('shows the newest findings and how many more there are', () => {
		const notes = Array.from({ length: run_board_render.NOTE_LIMIT + 2 }, (_, index) =>
			note(NOW - index * MINUTE, `observation ${String(index)}`),
		)
		const filed: BoardNote = {
			kind: 'filed',
			at_ms: NOW,
			issue: '3438',
			text: 'Count seats',
			found_during: '3415',
			is_decision: false,
		}
		const lines = lines_of(header({ layout: undefined }), [filed, ...notes])

		expect(lines).toContain(`  🆕 ${clock_of(NOW)} 3438 filed  Count seats (found during 3415)`)
		expect(lines).toContain(`  💬 ${clock_of(NOW)} 3415 note  observation 0`)
		expect(lines.at(-1)).toBe('  more 3')
	})

	it('says there is no run when none has started', () => {
		expect(run_board_render.render_no_run(NOW)).toStrictEqual([
			`■ backlogrun  no run  ${clock_of(NOW)}`,
		])
	})
})

const filed: BoardNote = {
	kind: 'filed',
	at_ms: NOW,
	issue: '3473',
	text: 'Lead',
	is_decision: false,
}

// joshuafolkken/kit#3478: the findings are named by icons the legend names, and by words in a chat.
describe('run_board_render.render findings icons', () => {
	it('draws the findings rule as 📌 and every row led by its icon with no kind word', () => {
		const lines = lines_of(header(), [filed, { ...filed, kind: 'park' }, note(NOW, 'seen')])
		const board = lines.slice(0, -1).join('\n')

		expect(lines).toContain(rule('📌'))
		expect(lines).toContain(`  🆕 ${clock_of(NOW)} 3473  Lead`)
		expect(lines).toContain(`  💤 ${clock_of(NOW)} 3473  Lead`)
		expect(lines).toContain(`  💬 ${clock_of(NOW)} 3415  seen`)

		for (const word of [WORDS.notes, 'filed', 'park', ' note ']) {
			expect(board).not.toContain(word)
		}
	})

	it('names the findings icons in the legend only while a finding is on screen', () => {
		const legend = '📌 findings and decisions  🆕 filed  💬 note'

		expect(lines_of(header(), [filed]).at(-1)).toBe(legend)
		expect(lines_of(header()).join('\n')).not.toContain('📌')
	})

	it('keeps the heading and the kind words in a chat, which draws no legend', () => {
		const lines = lines_of(header({ form: 'chat' }), [filed])

		expect(lines).toContain(rule(WORDS.notes))
		expect(lines.at(-1)).toBe(`  🆕 ${clock_of(NOW)} 3473 filed  Lead`)
	})
})

describe('run_board_render.render findings with no legend', () => {
	it('keeps the heading and the kind words on a screen with no plan read yet, which draws no legend', () => {
		const lines = lines_of(header({ layout: undefined }), [filed])

		expect(lines).toContain(rule(WORDS.notes))
		expect(lines.at(-1)).toBe(`  🆕 ${clock_of(NOW)} 3473 filed  Lead`)
	})
})

// joshuafolkken/kit#3437: a stopped run names the command that resumes its session, under the header.
describe('run_board_render.render resume', () => {
	it('draws the resume command only when the run stopped with a session', () => {
		const board = header({ layout: undefined, ended_ms: NOW })

		expect(lines_of(board).join('\n')).not.toContain('claude --resume')
		expect(run_board_render.render({ header: board, notes: [], resume: 'abc' })).toContain(
			'🙋 stopped — resume with  claude --resume abc',
		)
	})
})
