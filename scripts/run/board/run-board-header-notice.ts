import { issue_cite } from '#scripts/issue/issue-cite'
import { run_board_labels } from './run-board-labels'
import type { BoardLinks } from './run-board-link'
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

// 🔊 or 🔇 and the last notice, `—` before the first; nothing where the board reads no sound switch.
function part_of(fields: NoticeFields): string | undefined {
	const { is_sound_on, notice } = fields
	if (is_sound_on === undefined) return undefined
	const text = notice === undefined ? NONE : text_of(notice, fields.link)

	return `${is_sound_on ? SOUND_ON : SOUND_OFF} ${text}`
}

const run_board_header_notice = { next, part_of }

export { run_board_header_notice }
export type { Notice }
