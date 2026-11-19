import { describe, expect, it } from 'vitest'
import type { BoardNote } from './run-board-notes'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_notes, type NotesView } from './run-board-render-notes'
import { run_board_render_section } from './run-board-render-section'
import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#8117: a themed board keys each findings / notes line by the event it came from,
// after its indent, so the line types once and its indent is drawn whole.

const { EMPTY_LAYOUT, NOW } = run_board_render_fixture
const { notes_part } = run_board_render_notes
const { ROW_INDENT } = run_board_render_section
const { split_key, without_key } = run_board_row_key
const PARK: BoardNote = { kind: 'park', at_ms: NOW, issue: '42', text: 'a reason' }
const NARROW = 30

function same(reference: string): string {
	return reference
}

function line_of(view: Partial<NotesView>): string {
	return notes_part([PARK], { layout: EMPTY_LAYOUT, link: same, ...view }).lines[0] ?? ''
}

describe('run_board_render_notes keyed lines', () => {
	it('keys a line by its event after the indent where the board is keyed', () => {
		const split = split_key(line_of({ is_keyed: true }))

		expect(split.key).toBe(`note:park:42:${String(NOW)}`)
		expect(split.prefix).toBe(ROW_INDENT)
	})

	it('keys a note that names no issue by its kind and time alone', () => {
		const note = { ...PARK, issue: undefined }
		const [line = ''] = notes_part([note], {
			layout: EMPTY_LAYOUT,
			link: same,
			is_keyed: true,
		}).lines

		expect(split_key(line).key).toBe(`note:park::${String(NOW)}`)
	})

	it('keys no line where the board is not keyed, and draws the same text either way', () => {
		const plain = line_of({})

		expect(split_key(plain).key).toBeUndefined()
		expect(without_key(line_of({ is_keyed: true }))).toBe(plain)
	})

	it('keeps the same key where the legend or the pane’s width changes the text', () => {
		const keys = [
			line_of({ is_keyed: true }),
			line_of({ is_keyed: true, layout: undefined }),
			line_of({ is_keyed: true, columns: NARROW }),
		].map((line) => split_key(line).key)

		expect(new Set(keys).size).toBe(1)
	})

	it('cuts a keyed line to the pane as it cuts the same line without a key', () => {
		expect(without_key(line_of({ is_keyed: true, columns: NARROW }))).toBe(
			line_of({ columns: NARROW }),
		)
	})
})
