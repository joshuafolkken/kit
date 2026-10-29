import { styleText } from 'node:util'
import type { FiledKind } from '#scripts/run/event/run-event-filed'
import { run_board_earlier } from './run-board-earlier'
import { run_board_kind } from './run-board-kind'
import { run_board_labels, type Words } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_notes, type BoardNote } from './run-board-notes'
import { run_board_phase } from './run-board-phase'
import { run_board_render_notes } from './run-board-render-notes'
import type { ItemState } from './run-board-status'

// The legend at the foot of `run:board`: the symbols the frame draws, named once, so a row carries
// only what differs between rows. Drawn apart from the rows, which tell it the icons they draw.
// joshuafolkken/kit#4047: each naming only what the frame draws, on one line. An icon the frame draws
// beside its own word is not named — ⏳ under `⏳ queued`, 🙋 under `🙋 decision`, ✅ under `✅ done`
// and 📌 on `📌 findings` — so the legend names only an icon drawn with no word beside it, what a
// waiting row leads with among them.

const {
	FILED_KIND_ICONS,
	FILED_RUN_MARK,
	KIND_WORDS,
	OVERRUN_MARK,
	PHASE_ICONS,
	PHASE_WORDS,
	STATE_ICONS,
	WAITS_ICON,
	WAIT_ICONS,
	WAIT_WORDS,
	WORDS,
} = run_board_labels
const GAP = '  '

// What the frame draws, as the legend reads it.
interface LegendDrawn {
	// The icons the rows lead with — a running row leads with its phase, so 🔄 is named only while a
	// row draws it.
	leads: ReadonlySet<string>
	// Every icon a phase may be drawn with: the rows' leads, the header's third line and the rows' ends.
	icons: ReadonlySet<string>
	// The activity kinds the header's third line and the rows' ends draw, where their own words do not
	// name them (joshuafolkken/kit#3767, joshuafolkken/kit#3769).
	named: ReadonlyArray<string>
	// What a followup row's checks draw (joshuafolkken/kit#3770).
	checks: ReadonlyArray<string>
	// 🚧 and the reasons a held check is drawn with (joshuafolkken/kit#4052).
	held: ReadonlyArray<string>
	// ⛽ and the marks its gauges are drawn with, while the usage section is (joshuafolkken/kit#5395).
	quota?: ReadonlyArray<string> | undefined
	// A lane row leads with 🧍, its `run:solo` mark (joshuafolkken/kit#4625).
	solo: boolean
	// A merged row ends on 🔍, its overrun investigation running where no spinner turns
	// (joshuafolkken/kit#4772) or its result once it ended (joshuafolkken/kit#4818).
	overrun?: boolean | undefined
}

type LeadWords = ReadonlyArray<readonly [string, keyof Words]>

function states_of(states: ReadonlyArray<readonly [ItemState, keyof Words]>): LeadWords {
	return states.map(([state, word]) => [STATE_ICONS[state], word] as const)
}

// The row leads the legend can name, each with its word: in progress first, then the settled ones.
const PROGRESS_STATES: LeadWords = states_of([['running', 'in_progress']])
const SETTLED_STATES: LeadWords = [
	...states_of([
		['parked', 'parked'],
		['paused', 'paused'],
		['stopped', 'stopped'],
	]),
	[run_board_earlier.EARLIER_ICON, 'earlier'],
	...states_of([
		['unknown', 'unknown'],
		['done', 'done'],
		['withdrawn', 'withdrawn'],
	]),
]

function state_legend(states: LeadWords, leads: ReadonlySet<string>): Array<string> {
	return states.filter(([icon]) => leads.has(icon)).map(([icon, word]) => `${icon} ${WORDS[word]}`)
}

// The phases the frame draws, in the order a run passes them.
function phase_legend(icons: ReadonlySet<string>): Array<string> {
	return run_board_phase.PHASES.filter((phase) => icons.has(PHASE_ICONS[phase])).map(
		(phase) => `${PHASE_ICONS[phase]} ${WORDS[PHASE_WORDS[phase]]}`,
	)
}

// The release kinds the rows draw (joshuafolkken/kit#3577), in the release notes' order.
function kinds_of(rows: ReadonlyArray<BoardRow>): Array<FiledKind> {
	const drawn = new Set(rows.map((row) => row.kind))

	return run_board_kind.KIND_ORDER.filter((kind) => drawn.has(kind))
}

// The wait icon a row draws: the one a waiting row leads with, which names its blockers itself, else
// 🔗 where blockers follow the title of a row that waits on no condition of its own.
function wait_icon(row: BoardRow): string | undefined {
	return row.reason?.icon ?? (row.waits.length > 0 ? WAITS_ICON : undefined)
}

// What the waiting rows the frame draws lead with (joshuafolkken/kit#4288), in one fixed order.
function waits_legend(rows: ReadonlyArray<BoardRow>): Array<string> {
	const drawn = new Set(rows.map((row) => wait_icon(row)))

	return WAIT_WORDS.filter(([icon]) => drawn.has(icon)).map(
		([icon, word]) => `${icon} ${WORDS[word]}`,
	)
}

// 🧍 is named only while a lane row draws it, and once where a waiting row leads with it too
// (joshuafolkken/kit#4625).
function solo_legend(rows: ReadonlyArray<BoardRow>, drawn: LegendDrawn): Array<string> {
	if (!drawn.solo) return []

	const is_named = rows.some((row) => wait_icon(row) === WAIT_ICONS.solo)

	return is_named ? [] : [`${WAIT_ICONS.solo} ${WORDS.solo}`]
}

// ✚ is named only while a row the run filed draws it (joshuafolkken/kit#4099).
function filed_legend(
	rows: ReadonlyArray<BoardRow>,
	notes: ReadonlyArray<BoardNote>,
): Array<string> {
	const filed = run_board_notes.filed_numbers(notes)

	return rows.some((row) => filed.has(row.number)) ? [`${FILED_RUN_MARK} ${WORDS.filed_run}`] : []
}

// What is in progress, then what has settled.
function states_line(drawn: LegendDrawn): Array<string> {
	return [
		...state_legend(PROGRESS_STATES, drawn.leads),
		...phase_legend(drawn.icons),
		...new Set(drawn.named),
		...state_legend(SETTLED_STATES, drawn.leads),
	]
}

// The kinds, then the rest. The header's gauges and marks read by their place, so the legend leaves
// them.
function others_line(
	rows: ReadonlyArray<BoardRow>,
	drawn: LegendDrawn,
	notes: ReadonlyArray<BoardNote>,
): Array<string> {
	const kinds = kinds_of(rows)
	const kind_icons = kinds.map((kind) => FILED_KIND_ICONS[kind])
	const named = new Set([...drawn.leads, ...kind_icons])
	const kind_named = kinds.map((kind) => `${FILED_KIND_ICONS[kind]} ${WORDS[KIND_WORDS[kind]]}`)

	return [
		...kind_named,
		...waits_legend(rows),
		...solo_legend(rows, drawn),
		...filed_legend(rows, notes),
		...(drawn.overrun === true ? [`${OVERRUN_MARK} ${WORDS.overrun}`] : []),
		...drawn.held,
		...(drawn.quota ?? []),
		...drawn.checks,
		...run_board_render_notes.notes_legend(notes, named, rows),
	]
}

// One line, drawn only when it names something.
function legend_of(
	rows: ReadonlyArray<BoardRow>,
	drawn: LegendDrawn,
	notes: ReadonlyArray<BoardNote>,
): Array<string> {
	const entries = [...states_line(drawn), ...others_line(rows, drawn, notes)]

	return entries.length === 0 ? [] : [styleText('dim', entries.join(GAP))]
}

const run_board_render_legend = {
	legend_of,
}

export { run_board_render_legend }
export type { LegendDrawn }
