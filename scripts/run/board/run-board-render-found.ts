import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_overrun, type OverrunNote } from '#scripts/run/event/run-event-overrun'
import type { Found } from './run-board-found'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_title } from './run-board-render-title'
import type { ItemState } from './run-board-status'

// A done row's end after its time (joshuafolkken/kit#4772, joshuafolkken/kit#4818). A merged row says
// its lane's net minutes — `?′` where there are none — the numbers of the Issues its child filed, then
// what its overrun investigation came to and the numbers it filed (joshuafolkken/kit#4880), each group
// two spaces apart: `⏭` and why it was skipped, or 🔍 and the numbers it filed, `↪N` for each open
// Issue it appended causes to (joshuafolkken/kit#4858), `∅` and why it did not (each keyed cause's
// mechanism and minutes where it has them, joshuafolkken/kit#4911), `∅ ↻#N` for a recurrence commented
// on, or 💥 for an investigation that failed. While the investigation runs, the spinner stands for 🔍.
// A row its merge left no note on was never asked. A done row that did not merge says only what was
// filed during it.

const { OVERRUN_MARK } = run_board_labels
const DONE_STATES: ReadonlySet<ItemState> = new Set(['merged', 'done'])
const SEPARATOR = ', '
const GROUP_SEPARATOR = '  '
const MINUTES_WIDTH = 3
const MINUTE_MARK = '′'
const UNKNOWN_MINUTES = '?'
const SKIP_MARK = '⏭'
const NONE_MARK = '∅'
const RECURRED_MARK = '↻'
const FOLDED_MARK = '↪'
const FAILED_TEXT = `${OVERRUN_MARK} 💥`
const NO_RECORD = 'no record'
// The investigator writes its reason in about 15 characters; the row keeps no more.
const REASON_LIMIT = 16

function found_of(row: BoardRow, header: BoardHeader): Found | undefined {
	if (!DONE_STATES.has(row.state)) return undefined

	return header.found?.get(row.number)
}

function links_of(references: ReadonlyArray<string>, header: BoardHeader): string {
	return references.map((reference) => header.link(reference)).join(SEPARATOR)
}

// Every filing, the child's and the investigation's alike: a row that did not merge has no outcome
// to tell them apart by.
function numbers_of(found: Found | undefined, header: BoardHeader): string {
	return links_of([...(found?.filed ?? []), ...(found?.overrun_filed ?? [])], header)
}

function minutes_text(found: Found | undefined): string {
	const minutes = found?.minutes === undefined ? UNKNOWN_MINUTES : String(found.minutes)

	return `${minutes.padStart(MINUTES_WIDTH)}${MINUTE_MARK}`
}

// Whole minutes, `<1′` for a loss that rounds to none.
function loss_minutes(minutes: number): string {
	const rounded = Math.round(minutes)

	return rounded === 0 ? `<1${MINUTE_MARK}` : `${String(rounded)}${MINUTE_MARK}`
}

// Each mechanism and its summed minutes, the largest first (joshuafolkken/kit#4911), else the reason
// when no cause is keyed — `∅` already says nothing was filed.
function why_text(result: string): string {
	const losses = run_event_overrun.sum_by_key(run_event_overrun.small_causes_of(result))

	if (losses.length === 0) {
		return run_board_render_title.title_of(run_event_overrun.reason_of(result), REASON_LIMIT)
	}

	return losses.map(({ key, minutes }) => `${key} ${loss_minutes(minutes)}`).join(' ')
}

// An investigation that filed nothing: the recurrence it commented on, else why it did not.
function none_text(result: string): string {
	const recurred = run_event_overrun.recurred_of(result)

	if (recurred !== undefined) return `${NONE_MARK} ${RECURRED_MARK}${issue_cite.plain(recurred)}`

	return `${NONE_MARK} ${why_text(result)}`
}

// The open Issues the investigation appended its causes to, each a link with no `#`.
function folded_text(issues: ReadonlyArray<number>, header: BoardHeader): string {
	const links = issues.map((issue) => `${FOLDED_MARK}${header.link(String(issue))}`)

	return `${OVERRUN_MARK} ${links.join(SEPARATOR)}`
}

// The result decides, not whether anything was filed: an event written before the overrun mark reads
// as the child's.
function ended_text(result: string, header: BoardHeader): string {
	const folded = run_event_overrun.folded_of(result)

	if (folded.length > 0) return folded_text(folded, header)
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
	if (note.kind === 'ended') return ended_text(note.result, header)

	return note.kind === 'started' ? started_text(found, header) : FAILED_TEXT
}

function joined(parts: ReadonlyArray<string>, separator: string): string {
	return parts.filter((part) => part !== '').join(separator)
}

// What the investigation came to, then the Issues it filed.
function investigation_text(found: Found | undefined, header: BoardHeader): string {
	const outcome =
		found?.overrun === undefined
			? `${SKIP_MARK} ${NO_RECORD}`
			: outcome_text(found, found.overrun, header)

	return joined([outcome, links_of(found?.overrun_filed ?? [], header)], ' ')
}

// The minutes, the child's own filings, then the investigation, each group apart by two spaces.
function merged_text(row: BoardRow, header: BoardHeader): string {
	const found = found_of(row, header)
	const own = links_of(found?.filed ?? [], header)

	return joined([minutes_text(found), own, investigation_text(found, header)], GROUP_SEPARATOR)
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
