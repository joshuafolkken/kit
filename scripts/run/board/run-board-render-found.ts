import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_overrun, type OverrunNote } from '#scripts/run/event/run-event-overrun'
import type { Found } from './run-board-found'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_title } from './run-board-render-title'
import type { ItemState } from './run-board-status'

// A done row's end after its time (joshuafolkken/kit#4772, joshuafolkken/kit#4818). A merged row says
// its lane's net minutes — `?′` where there are none — what its overrun investigation came to, then the
// numbers of the Issues filed during its child's work: `⏭` and why it was skipped, or 🔍 alone where it
// filed, `∅` and why it did not, `∅ ↻#N` for a recurrence commented on, or 💥 for an investigation that
// failed. While the investigation runs, the spinner stands for 🔍. A row its merge left no note on was
// never asked. A done row that did not merge says only what was filed during it.

const { OVERRUN_MARK } = run_board_labels
const DONE_STATES: ReadonlySet<ItemState> = new Set(['merged', 'done'])
const SEPARATOR = ', '
const MINUTES_WIDTH = 3
const MINUTE_MARK = '′'
const UNKNOWN_MINUTES = '?'
const SKIP_MARK = '⏭'
const NONE_MARK = '∅'
const RECURRED_MARK = '↻'
const FAILED_TEXT = `${OVERRUN_MARK} 💥`
const NO_RECORD = 'no record'
// The investigator writes its reason in about 15 characters; the row keeps no more.
const REASON_LIMIT = 16

function found_of(row: BoardRow, header: BoardHeader): Found | undefined {
	if (!DONE_STATES.has(row.state)) return undefined

	return header.found?.get(row.number)
}

function numbers_of(found: Found | undefined, header: BoardHeader): string {
	return (found?.filed ?? []).map((reference) => header.link(reference)).join(SEPARATOR)
}

function minutes_text(found: Found | undefined): string {
	const minutes = found?.minutes === undefined ? UNKNOWN_MINUTES : String(found.minutes)

	return `${minutes.padStart(MINUTES_WIDTH)}${MINUTE_MARK}`
}

// An investigation that filed nothing: the recurrence it commented on, else its reason.
function none_text(result: string): string {
	const recurred = run_event_overrun.recurred_of(result)

	if (recurred !== undefined) return `${NONE_MARK} ${RECURRED_MARK}${issue_cite.plain(recurred)}`

	return `${NONE_MARK} ${run_board_render_title.title_of(run_event_overrun.reason_of(result), REASON_LIMIT)}`
}

// The result decides, not whether anything was filed: the numbers also hold the child's own filings.
function ended_text(result: string): string {
	if (result.startsWith(run_event_overrun.FILED_RESULT)) return OVERRUN_MARK

	return `${OVERRUN_MARK} ${none_text(result)}`
}

// A started session still running turns the spinner, one gone without its end note failed, and one
// whose start token was never read stands still while its pid lives.
function started_text(found: Found, header: BoardHeader): string {
	if (found.is_investigating === false) return FAILED_TEXT
	if (found.is_investigating === undefined) return OVERRUN_MARK

	return header.spinner ?? OVERRUN_MARK
}

// A lane at or under the threshold says nothing past its minutes.
function outcome_text(found: Found, note: OverrunNote, header: BoardHeader): string {
	if (note.kind === 'within') return ''
	if (note.kind === 'skipped') return `${SKIP_MARK} ${note.reason}`
	if (note.kind === 'ended') return ended_text(note.result)

	return note.kind === 'started' ? started_text(found, header) : FAILED_TEXT
}

function merged_text(row: BoardRow, header: BoardHeader): string {
	const found = found_of(row, header)
	const outcome =
		found?.overrun === undefined
			? `${SKIP_MARK} ${NO_RECORD}`
			: outcome_text(found, found.overrun, header)

	return [minutes_text(found), outcome, numbers_of(found, header)]
		.filter((part) => part !== '')
		.join(' ')
}

// Empty for an unmerged done row with nothing filed, for every row not done, and on a board that read
// no stream.
function found_text(row: BoardRow, header: BoardHeader): string {
	if (row.state === 'merged' && header.found !== undefined) return merged_text(row, header)

	return numbers_of(found_of(row, header), header)
}

// The row draws 🔍, which the legend names.
function is_still(row: BoardRow, header: BoardHeader): boolean {
	return row.state === 'merged' && found_text(row, header).includes(OVERRUN_MARK)
}

const run_board_render_found = { found_text, is_still }

export { run_board_render_found }
