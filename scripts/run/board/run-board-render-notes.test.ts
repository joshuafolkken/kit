import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_notes, type BoardNote } from './run-board-notes'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#3430: what the board says below its plan — the findings, the resume command and a
// board with no run.

const { clock_of, minute_of } = run_board_labels
const { EMPTY_LAYOUT, MINUTE, NOW, WORDS, header, lines_of, note, rule } = run_board_render_fixture

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

		expect(lines).toContain(`  🆕 ${minute_of(NOW)} 3438 filed  Count seats (found during 3415)`)
		expect(lines).toContain(`  💬 ${minute_of(NOW)} 3415 note  observation 0`)
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
const park: BoardNote = { ...filed, kind: 'park' }
const NOTES_LEGEND = '📌 findings and decisions'

// joshuafolkken/kit#3478: the findings are named by icons the legend names, and by words in a chat.
describe('run_board_render.render findings icons', () => {
	it('draws the findings rule as 📌 and every row led by its icon with no kind word', () => {
		const lines = lines_of(header(), [filed, park, note(NOW, 'seen')])
		const board = lines.slice(0, -1).join('\n')

		expect(lines).toContain(rule('📌'))
		expect(lines).toContain(`  🆕 ${minute_of(NOW)} 3473  Lead`)
		expect(lines).toContain(`  💤 ${minute_of(NOW)} 3473  Lead`)
		expect(lines).toContain(`  💬 ${minute_of(NOW)} 3415  seen`)

		for (const word of [WORDS.notes, 'filed', 'park', ' note ']) {
			expect(board).not.toContain(word)
		}
	})

	it('names the findings icons in the legend only while a finding is on screen', () => {
		expect(lines_of(header(), [filed]).at(-1)).toBe(`${NOTES_LEGEND}  🆕 filed`)
		expect(lines_of(header()).join('\n')).not.toContain('📌')
	})

	it('keeps the heading and the kind words in a chat, which draws no legend', () => {
		const lines = lines_of(header({ form: 'chat' }), [filed])

		expect(lines).toContain(rule(WORDS.notes))
		expect(lines.at(-1)).toBe(`  🆕 ${minute_of(NOW)} 3473 filed  Lead`)
	})
})

// joshuafolkken/kit#3489: the legend names only the kinds the findings section draws.
describe('run_board_render.render findings legend', () => {
	it('names 💤 and 💬 only while a drawn finding leads with them', () => {
		const every = lines_of(header(), [filed, park, note(NOW, 'seen')]).at(-1)

		expect(every).toBe(`${NOTES_LEGEND}  🆕 filed  💤 parked  💬 note`)
		expect(lines_of(header(), [note(NOW, 'seen')]).at(-1)).toBe(`${NOTES_LEGEND}  💬 note`)
	})

	it('does not name 💤 again where a parked row already names it', () => {
		const parked: BoardRow = {
			number: 7,
			title: 'Seven',
			kind: undefined,
			state: 'parked',
			status: undefined,
			waits: [],
		}
		const layout = { ...EMPTY_LAYOUT, active: [parked] }

		expect(lines_of(header({ layout }), [park]).at(-1)).toBe(`💤 parked  ${NOTES_LEGEND}`)
	})

	it('does not name a kind whose findings are past the limit and not drawn', () => {
		const shown = Array.from({ length: run_board_render.NOTE_LIMIT }, () => filed)
		const legend = lines_of(header(), [...shown, note(NOW, 'hidden')]).at(-1)

		expect(legend).toBe(`${NOTES_LEGEND}  🆕 filed`)
	})
})

// joshuafolkken/kit#3494: a filed Issue's line leads with its kind in place of 🆕, and the legend
// names only the kinds drawn.
describe('run_board_render.render filed kinds', () => {
	const bug: BoardNote = { ...filed, filed_kind: 'bug' }
	const enhancement: BoardNote = { ...filed, filed_kind: 'enhancement' }
	const breaking: BoardNote = { ...filed, filed_kind: 'breaking-change' }

	it('leads each filed line with its kind’s icon, and an unclassified one with 🆕', () => {
		const lines = lines_of(header(), [breaking, bug, enhancement, filed])

		for (const icon of ['🧨', '🐛', '✨', '🆕']) {
			expect(lines).toContain(`  ${icon} ${minute_of(NOW)} 3473  Lead`)
		}
	})

	// joshuafolkken/kit#3577: in the release notes' order, by the words the rows' legend names them with.
	it('names only the kinds drawn, in the legend’s order', () => {
		const every = lines_of(header(), [filed, enhancement, bug, breaking]).at(-1)

		expect(every).toBe(`${NOTES_LEGEND}  🧨 breaking  ✨ feature  🐛 fix  🆕 filed`)
		expect(lines_of(header(), [bug, enhancement]).at(-1)).toBe(
			`${NOTES_LEGEND}  ✨ feature  🐛 fix`,
		)
	})
})

// joshuafolkken/kit#3577: a kind the rows' legend names is not named again among the findings.
describe('run_board_render.render filed kinds beside row kinds', () => {
	const bug: BoardNote = { ...filed, filed_kind: 'bug' }
	const enhancement: BoardNote = { ...filed, filed_kind: 'enhancement' }

	it('does not name a kind again where a row already names it', () => {
		const row: BoardRow = {
			number: 7,
			title: 'Seven',
			kind: 'bug',
			state: 'waiting',
			status: undefined,
			waits: [],
		}
		const layout = { ...EMPTY_LAYOUT, active: [row] }

		expect(lines_of(header({ layout }), [bug, enhancement]).at(-1)).toBe(
			`⏳ waiting  🐛 fix  ${NOTES_LEGEND}  ✨ feature`,
		)
	})

	it('keeps the kind word filed in a chat, which draws no legend', () => {
		expect(lines_of(header({ form: 'chat' }), [bug]).at(-1)).toBe(
			`  🐛 ${minute_of(NOW)} 3473 filed  Lead`,
		)
	})
})

function bracketed(reference: string): string {
	return `[${reference}]`
}

// joshuafolkken/kit#3520: a finding's numbers open their GitHub issue, as the plan's rows do.
describe('run_board_render.render findings links', () => {
	const found: BoardNote = { ...filed, issue: 'other/repo#12', found_during: '3415' }

	it('links the finding’s issue and the issue it was found during', () => {
		const lines = lines_of(header({ link: bracketed }), [found, note(NOW, 'seen')])

		expect(lines).toContain(`  🆕 ${minute_of(NOW)} [other/repo#12]  Lead (found during [3415])`)
		expect(lines).toContain(`  💬 ${minute_of(NOW)} [3415]  seen`)
	})

	it('draws the numbers unchanged where the terminal gets no link', () => {
		expect(lines_of(header(), [found])).toContain(
			`  🆕 ${minute_of(NOW)} other/repo#12  Lead (found during 3415)`,
		)
	})
})

// joshuafolkken/kit#3531: a bare park's line names the parked issue by the board's title.
describe('run_board_render.render park titles', () => {
	it('draws a bare park with the title the board holds for it', () => {
		const events = [{ pos: 1, at: new Date(NOW).toISOString(), kind: 'park', text: '#3526 parked' }]
		const notes = run_board_notes.notes_of(events, new Map([[3526, 'Lead the lanes']]))

		expect(lines_of(header(), notes)).toContain(`  💤 ${minute_of(NOW)} 3526  Lead the lanes`)
	})
})

describe('run_board_render.render findings with no legend', () => {
	it('keeps the heading and the kind words on a screen with no plan read yet, which draws no legend', () => {
		const lines = lines_of(header({ layout: undefined }), [filed])

		expect(lines).toContain(rule(WORDS.notes))
		expect(lines.at(-1)).toBe(`  🆕 ${minute_of(NOW)} 3473 filed  Lead`)
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
