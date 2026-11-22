import { stripVTControlCharacters } from 'node:util'
import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_labels } from './run-board-labels'
import { run_board_row_key } from './run-board-row-key'
import { run_board_typing } from './run-board-typing'

// joshuafolkken/kit#8370: where the rows decode, the header's now line types instead and glows, so the
// downpour never hides it — the block and the two newest letters white, the letters before them bright,
// the whole line bright for half a second after it types through, then as the frame draws it.

const GLOW_HEAD = 2
const GLOW_MS = 500
const NOW_PREFIX = run_board_row_key.key_of('now', '')
const { SHADES } = run_board_header_trace
const { cut_styled, tail_styled } = run_board_cut_styled
const { painted } = run_board_labels

// Where a glowing line is: the columns drawn whole before its words, the columns typed by now and how
// long ago it typed through — below 0 while it types.
interface GlowAt {
	prefix_columns: number
	columns: number
	since_typed_ms: number
}

// Whether the row the key names glows where the rows decode: the header's now line alone.
function glows(key: string): boolean {
	return key.startsWith(NOW_PREFIX)
}

// Whether a glowing line still glows `since_typed_ms` after it typed through.
function is_lit(since_typed_ms: number): boolean {
	return since_typed_ms < GLOW_MS
}

// The plain letters of `text` from column `from` to column `to`.
function letters(text: string, from: number, to: number): string {
	return stripVTControlCharacters(tail_styled(cut_styled(text, to), from))
}

// The line as it glows at `at`: the prefix as drawn, then the letters typed by then.
function glowed(text: string, at: GlowAt): string {
	if (!is_lit(at.since_typed_ms)) return text
	const prefix = cut_styled(text, at.prefix_columns)

	if (at.since_typed_ms >= 0) {
		return `${prefix}${painted(SHADES.bright, letters(text, at.prefix_columns, at.columns))}`
	}

	const head_from = Math.max(at.prefix_columns, at.columns - GLOW_HEAD)
	const early = painted(SHADES.bright, letters(text, at.prefix_columns, head_from))
	const head = `${letters(text, head_from, at.columns)}${run_board_typing.CURSOR}`

	return `${prefix}${early}${painted(SHADES.head, head)}`
}

const run_board_type_glow = { GLOW_MS, glowed, glows, is_lit }

export { run_board_type_glow }
export type { GlowAt }
