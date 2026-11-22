import { issue_cite } from '#scripts/issue/issue-cite'
import { run_board_faint } from './run-board-faint'
import { run_board_labels } from './run-board-labels'
import type { BoardLinks } from './run-board-link'
import { run_board_row_key } from './run-board-row-key'
import type { CueName } from './run-board-sound-cues'
import type { Sounding } from './run-board-sound-repeat'
import { run_board_standing, type StandingHeader } from './run-board-standing'

// The end of the header's second line (joshuafolkken/kit#8107): the sound switch where the board reads
// one, then what holds over frames (`run-board-standing.ts`), else the last notice the board picked —
// its cue's icon, what sounded it, when, `×2` where it sounded again — faint once its cause no longer
// holds (joshuafolkken/kit#8475). Every frame draws the slot; `--once`, `--chat` and Telegram read no
// switch and draw the slot without it. `--frame` draws the switch and the notice its flags fix
// (`run-board-frame-preview.ts`).

const { STATE_ICONS, minute_of } = run_board_labels
const SOUND_ON = '🔊'
const SOUND_OFF = '🔇'
const NONE = '—'
const REPEAT = '×2'
// Each cue as the state its row enters.
const CUE_ICONS: Readonly<Record<CueName, string>> = {
	launch: STATE_ICONS.running,
	'lane-end': STATE_ICONS.merged,
	drain: STATE_ICONS.done,
	human: STATE_ICONS.human,
	alert: STATE_ICONS.stopped,
}

type Cause = Sounding['cause']

// The last notice, the moment it was picked, and whether its cause has stopped holding since.
interface Notice extends Sounding {
	readonly at_ms: number
	readonly is_settled?: boolean | undefined
}

interface NoticeFields extends Pick<BoardLinks, 'link'>, StandingHeader {
	// The live board's sound switch `s` flips (`run-board-keys.ts`); `undefined` where no key is read.
	is_sound_on?: boolean | undefined
	notice?: Notice | undefined
	// Where the board types rows (`run-board-type-rows.ts`).
	is_keyed?: boolean | undefined
}

function is_same(left: Cause, right: Cause): boolean {
	return left.cue === right.cue && left.issue === right.issue && left.word === right.word
}

// The notice a frame leaves for the next: this frame's sounding, else the last one, kept muted or not —
// settled once its cause is gone from what the frame holds; a frame that reads none keeps the last say.
function next(
	previous: Notice | undefined,
	sounding: Sounding | undefined,
	now_ms: number,
	held?: ReadonlyArray<Cause>,
): Notice | undefined {
	const notice = sounding === undefined ? previous : { ...sounding, at_ms: now_ms }

	if (notice === undefined || held === undefined) return notice

	return { ...notice, is_settled: held.every((cause) => !is_same(cause, notice.cause)) }
}

// What sounded: its issue linked as the board links one, else the run's own words.
function cause_of(notice: Notice, link: BoardLinks['link']): string {
	const { issue, word } = notice.cause

	return issue === undefined ? word : issue_cite.plain_for('terminal', link(String(issue)))
}

function text_of(notice: Notice, link: BoardLinks['link']): string {
	const repeat = notice.is_repeat ? ` ${REPEAT}` : ''
	const words = `${CUE_ICONS[notice.cause.cue]} ${cause_of(notice, link)} ${minute_of(notice.at_ms)}`

	return `${words}${repeat}`
}

// The last notice's words, faint once settled, `—` before the first; typed by its plain words, so
// settling only fades it and does not type it again.
function notice_words(fields: NoticeFields): readonly [string, string] {
	const { notice } = fields

	if (notice === undefined) return [NONE, NONE]

	const text = text_of(notice, fields.link)

	return [notice.is_settled === true ? run_board_faint.faint(text) : text, text]
}

// What the slot says, and the words it is typed by.
function words_of(fields: NoticeFields): readonly [string, string] {
	return run_board_standing.slot_of(fields) ?? notice_words(fields)
}

// 🔊 or 🔇 where the board reads the switch, then the slot. Where the board types rows the words carry
// their key behind the switch, so they type when the slot changes and not when only the switch flips
// (joshuafolkken/kit#8114).
function part_of(fields: NoticeFields): string {
	const [words, key] = words_of(fields)
	const section = fields.is_keyed === true ? 'notice' : undefined
	const slot = run_board_row_key.keyed(section, key, words)
	const { is_sound_on } = fields

	if (is_sound_on === undefined) return slot

	return `${is_sound_on ? SOUND_ON : SOUND_OFF} ${slot}`
}

// The key `part_of` gives the words, so a frame knows them typed; none where it gives none.
function key_of(fields: NoticeFields): string | undefined {
	if (fields.is_keyed !== true) return undefined

	return run_board_row_key.key_of('notice', words_of(fields)[1])
}

const run_board_header_notice = { key_of, next, part_of }

export { run_board_header_notice }
export type { Notice }
