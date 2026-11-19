import { issue_cite } from '#scripts/issue/issue-cite'
import { run_board_labels } from './run-board-labels'
import type { BoardLinks } from './run-board-link'
import { run_board_row_key } from './run-board-row-key'
import type { Sounding } from './run-board-sound-repeat'

// The end of the header's second line on a live board (joshuafolkken/kit#8107): the sound switch, then
// the last notice the board picked — when, which cue, and what sounded it — so a cue heard, or one the
// muted board kept quiet, can be read off the screen. `--once`, `--chat` and Telegram read no switch and
// draw none of it.

const SOUND_ON = '🔊'
const SOUND_OFF = '🔇'
const NONE = '—'
const SEPARATOR = ' · '
const REPEAT = ' (repeat)'

// The last notice and the moment it was picked.
interface Notice extends Sounding {
	readonly at_ms: number
}

interface NoticeFields extends Pick<BoardLinks, 'link'> {
	// The live board's sound switch `s` flips (`run-board-keys.ts`); `undefined` where no key is read.
	is_sound_on?: boolean | undefined
	notice?: Notice | undefined
	// Where the board types rows (`run-board-type-rows.ts`).
	is_keyed?: boolean | undefined
}

// The notice a frame leaves for the next: this frame's sounding, else the last one, kept muted or not.
function next(
	previous: Notice | undefined,
	sounding: Sounding | undefined,
	now_ms: number,
): Notice | undefined {
	return sounding === undefined ? previous : { ...sounding, at_ms: now_ms }
}

// What sounded, its issue linked as the board links one.
function message_of(notice: Notice, link: BoardLinks['link']): string {
	const { issue, word } = notice.cause

	return issue === undefined
		? word
		: `${issue_cite.plain_for('terminal', link(String(issue)))} ${word}`
}

function text_of(notice: Notice, link: BoardLinks['link']): string {
	const repeat = notice.is_repeat ? REPEAT : ''
	const minute = run_board_labels.minute_of(notice.at_ms)

	return `${minute} ${notice.cause.cue}${SEPARATOR}${message_of(notice, link)}${repeat}`
}

// The last notice's words, `—` before the first.
function words_of(fields: NoticeFields): string {
	return fields.notice === undefined ? NONE : text_of(fields.notice, fields.link)
}

// 🔊 or 🔇 and the last notice; nothing where the board reads no sound switch. Where the board types
// rows the words carry their key behind the switch, so they type when the notice changes and not when
// only the switch flips (joshuafolkken/kit#8114).
function part_of(fields: NoticeFields): string | undefined {
	const { is_sound_on } = fields
	if (is_sound_on === undefined) return undefined
	const words = words_of(fields)
	const section = fields.is_keyed === true ? 'notice' : undefined

	return `${is_sound_on ? SOUND_ON : SOUND_OFF} ${run_board_row_key.keyed(section, words, words)}`
}

// The key `part_of` gives the words, so a frame knows them typed; none where it gives none.
function key_of(fields: NoticeFields): string | undefined {
	if (fields.is_sound_on === undefined || fields.is_keyed !== true) return undefined

	return run_board_row_key.key_of('notice', words_of(fields))
}

const run_board_header_notice = { key_of, next, part_of }

export { run_board_header_notice }
export type { Notice }
