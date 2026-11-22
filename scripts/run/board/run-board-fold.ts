import { run_board_cut_styled } from './run-board-cut-styled'
import {
	run_board_fit,
	type DetailPart,
	type FrameParts,
	type NotesPart,
	type PlanSection,
	type SectionKey,
	type TerminalSize,
} from './run-board-fit'
import { run_board_flash_parts } from './run-board-flash-parts'
import { run_board_lamps, type PanelSpan } from './run-board-lamps'
import { run_board_render_section } from './run-board-render-section'
import { run_board_spot } from './run-board-spot'

// A live `run:board`'s sections folded and unfolded by one key each (joshuafolkken/kit#4172): every
// section starts as the last board left it, and what a person folds is saved to `~/.claude/josh/board.json`
// (`$CLAUDE_CONFIG_DIR` in its place) on every fold (`run-board-fold-store.ts`, joshuafolkken/kit#7213).
// A folded section is its heading alone, led by ▸ and saying what it holds, and the rows it gave up go
// to the other sections before `run-board-fit.ts` cuts anything; an unfolded one's heading is led by ▾.

const { folded_head, lone_head, open_head, row_count, widened } = run_board_render_section
const SECTION_KEYS: ReadonlyMap<string, SectionKey> = new Map([
	['t', 'throughput'],
	['u', 'usage'],
	['l', 'lanes'],
	['p', 'processes'],
	['f', 'findings'],
	['q', 'queued'],
	['w', 'waiting'],
	['d', 'done'],
])
const ALL_KEY = 'a'
// Flips the board's sound on and off (`run-board-keys.ts`); named here so the key line lists it.
const SOUND_KEY = 's'
const SECTIONS: ReadonlyArray<SectionKey> = [...SECTION_KEYS.values()]
const KEYS_LINE = ` ${[...SECTION_KEYS.keys()].join(' ')}: fold · ${ALL_KEY}: all · ${SOUND_KEY}: sound · Ctrl-C: quit`

// The live terminal a frame is kept within, the footer the frame ends on and gives way first, and the
// sections a person folded; none for a frame that is not redrawn in place, which is drawn as it was.
interface FrameBounds {
	is_flash_keyed?: boolean | undefined
	size?: TerminalSize | undefined
	footer?: ReadonlyArray<string> | undefined
	folded?: ReadonlySet<SectionKey> | undefined
}

interface Headed {
	head: ReadonlyArray<string>
	is_folded?: boolean | undefined
	tail?: string | undefined
}

function flipped(folded: ReadonlySet<SectionKey>, section: SectionKey): ReadonlySet<SectionKey> {
	const rest = [...folded].filter((key) => key !== section)

	return new Set(folded.has(section) ? rest : [...rest, section])
}

// What a key leaves folded: `a` folds every section, or unfolds them all once every one is folded; a key
// that names no section leaves it as it was.
function toggled(folded: ReadonlySet<SectionKey>, key: string): ReadonlySet<SectionKey> {
	if (key === ALL_KEY) return new Set(folded.size === SECTIONS.length ? [] : SECTIONS)

	const section = SECTION_KEYS.get(key)

	return section === undefined ? folded : flipped(folded, section)
}

// A part's heading: ▾ while it is open, its one ▸ line saying `summary` once it is folded.
function headed<Part extends Headed>(part: Part, label: string, summary: string | undefined): Part {
	if (summary === undefined) return { ...part, head: open_head(part.head, label) }

	return { ...part, head: folded_head(label, summary), is_folded: true }
}

// A folded section counts its rows, the priorities among them after the count.
function fold_section(section: PlanSection, folded: ReadonlySet<SectionKey>): PlanSection {
	const { key, label } = section

	if (label === undefined) return section
	if (key === undefined) return { ...section, head: lone_head(section.head, label) }
	if (!folded.has(key)) return headed(section, label, undefined)

	const summary = `${String(row_count(section.lines))}${section.tally ?? ''}`

	return { ...headed(section, label, summary), lines: [] }
}

// The findings count every one there is, the ones past the section's limit too; with none there is no
// section to fold.
function fold_notes(notes: NotesPart, folded: ReadonlySet<SectionKey>): NotesPart {
	const { label } = notes

	if (label === undefined || notes.lines.length === 0) return notes
	if (!folded.has('findings')) return headed(notes, label, undefined)

	const count = String(notes.lines.length + notes.hidden)

	return { ...headed(notes, label, count), lines: [], hidden: 0 }
}

// A folded detail part says its summary: the processes each group's totals, the usage gauges each
// provider's percents, the throughput each row's closes per hour.
function fold_detail(
	part: DetailPart | undefined,
	folded: ReadonlySet<SectionKey>,
	key: SectionKey,
): DetailPart | undefined {
	if (part?.label === undefined) return part
	if (!folded.has(key)) return headed(part, part.label, undefined)

	return { ...headed(part, part.label, part.summary ?? ''), lines: [] }
}

function fold_parts(parts: FrameParts, folded: ReadonlySet<SectionKey>): FrameParts {
	return {
		...parts,
		throughput: fold_detail(parts.throughput, folded, 'throughput'),
		usage: fold_detail(parts.usage, folded, 'usage'),
		plan: parts.plan.map((section) => fold_section(section, folded)),
		below: parts.below?.map((section) => fold_section(section, folded)),
		processes: fold_detail(parts.processes, folded, 'processes'),
		notes: fold_notes(parts.notes, folded),
	}
}

// How far a rule runs: on to `width`, its tail kept within the pane's `columns`.
interface Reach {
	width: number
	columns?: number | undefined
}

function widened_part<Part extends Headed>(part: Part, reach: Reach): Part {
	return { ...part, head: widened(part.head, reach.width, part.tail, reach.columns) }
}

function widened_detail(part: DetailPart | undefined, reach: Reach): DetailPart | undefined {
	return part === undefined ? undefined : widened_part(part, reach)
}

// Every rule run on to the lane rows' title column, folded or open (joshuafolkken/kit#5520).
function widened_parts(parts: FrameParts): FrameParts {
	const { rule_width: width, columns } = parts

	if (width === undefined) return parts

	const reach = { width, columns }

	return {
		...parts,
		throughput: widened_detail(parts.throughput, reach),
		usage: widened_detail(parts.usage, reach),
		plan: parts.plan.map((section) => widened_part(section, reach)),
		below: parts.below?.map((section) => widened_part(section, reach)),
		processes: widened_detail(parts.processes, reach),
		notes: widened_part(parts.notes, reach),
	}
}

// No panel: every panel started is dropped.
const NO_PANEL: PanelSpan = { start: 0, end: 0 }
const { LAMP_START } = run_board_spot
// A cut row's last column and the blank after it, before the panel's start.
const CUT_GAP = 2

// Every panel starts where the throughput rows' does and runs on to the end of the throughput rule, its
// head's widest line (joshuafolkken/kit#8236, joshuafolkken/kit#8277); none where no throughput row starts
// one — a folded or missing section.
function panel_span(throughput: DetailPart | undefined): PanelSpan {
	if (throughput === undefined) return NO_PANEL
	const end = Math.max(...throughput.head.map((line) => run_board_fit.width_of(line)))
	const starts = throughput.lines.map((line) => run_board_lamps.start_column(line.text))
	const start = starts.find((column) => column !== undefined)

	return start === undefined ? NO_PANEL : { start, end }
}

type DetailLine = DetailPart['lines'][number]

// The usage part as its panels are run, and the span its rows run them to.
interface RowsFit {
	usage: DetailPart
	rows: PanelSpan
}

function is_line_clear(line: DetailLine, span: PanelSpan): boolean {
	const column = run_board_lamps.start_column(line.text)

	return column === undefined || column < span.start
}

// A line reaching the panel's start with the trailing note its text ends on left off; one clear of it
// keeps its note.
function without_aside(line: DetailLine, span: PanelSpan): DetailLine {
	const { text, aside } = line
	const index = aside === undefined ? -1 : text.lastIndexOf(aside)
	if (aside === undefined || index === -1 || is_line_clear(line, span)) return line

	return { ...line, text: `${text.slice(0, index)}${text.slice(index + aside.length)}` }
}

// A line reaching the panel's start still, cut a blank short of it with its panel's start kept: the
// panel is always kept beside the usage rows (joshuafolkken/kit#8695). The marker's color escapes hold
// no blank, so the last blank before it is the gap, and the marker is kept with its escapes whole.
function cut_line(line: DetailLine, span: PanelSpan): DetailLine {
	const { text } = line
	if (is_line_clear(line, span)) return line

	const gap = text.lastIndexOf(' ', text.indexOf(LAMP_START))
	const before = run_board_cut_styled.cut_styled(text.slice(0, gap), span.start - CUT_GAP)

	return { ...line, text: `${before}${text.slice(gap)}` }
}

// A usage part with no panel beside it — a folded throughput, or no room — draws each row's gauged text
// where it carries one (joshuafolkken/kit#8695).
function gauged(usage: DetailPart): DetailPart {
	return { ...usage, lines: usage.lines.map((line) => ({ ...line, text: line.full ?? line.text })) }
}

// The usage rows run their panels on every row: where one's text reaches the panel's start, the
// reaching rows' asides — a stale reading's age — are left off first (joshuafolkken/kit#8644), then a
// row reaching it still is cut (joshuafolkken/kit#8695); none where the span has no room for a panel.
function rows_fit(usage: DetailPart, span: PanelSpan): RowsFit {
	if (run_board_lamps.count_of(span.end - span.start) === 0) {
		return { usage: gauged(usage), rows: NO_PANEL }
	}

	const lines = usage.lines.map((line) => cut_line(without_aside(line, span), span))

	return { usage: { ...usage, lines }, rows: span }
}

// The usage rule's row started as a panel row where the panel rains and the rows under it run theirs
// (joshuafolkken/kit#8647); a folded usage, or rows with no panel, keep the rule whole.
function is_rule_rained(part: DetailPart, rows: PanelSpan): boolean {
	return part.is_rule_lamped === true && part.is_folded !== true && rows !== NO_PANEL
}

function rule_lamped(part: DetailPart, rows: PanelSpan): DetailPart {
	const rule = part.head.at(-1)
	if (rule === undefined || !is_rule_rained(part, rows)) return part

	return {
		...part,
		head: [...part.head.slice(0, -1), run_board_lamps.rule_started(rule, rows.start)],
	}
}

function lamped(
	whole: DetailPart | undefined,
	span: PanelSpan,
	rows = span,
): DetailPart | undefined {
	if (whole === undefined) return undefined
	const part = rule_lamped(whole, rows)
	const head = part.head.map((line) => run_board_lamps.expanded(line, span))
	const lines = part.lines.map((line) => ({
		...line,
		text: run_board_lamps.expanded(line.text, rows),
	}))

	return { ...part, head, lines }
}

function lamped_parts(parts: FrameParts): FrameParts {
	const { throughput, usage } = parts
	const span = panel_span(throughput)
	const fit = usage === undefined ? undefined : rows_fit(usage, span)

	return {
		...parts,
		throughput: lamped(throughput, span),
		usage: lamped(fit?.usage, span, fit?.rows),
		usage_alone: lamped(usage === undefined ? undefined : gauged(usage), NO_PANEL),
	}
}

// A live frame is kept within its terminal, folded as a person folded it; any other is drawn whole.
function bounded(parts: FrameParts, bounds: FrameBounds): Array<string> {
	const { size, folded } = bounds
	const ruled = widened_parts(folded === undefined ? parts : fold_parts(parts, folded))
	const shown = run_board_flash_parts.keyed(lamped_parts(ruled), bounds.is_flash_keyed)

	return size === undefined ? run_board_fit.whole(shown) : run_board_fit.fit(shown, size)
}

const run_board_fold = { KEYS_LINE, SECTIONS, SOUND_KEY, bounded, fold_parts, toggled }

export { run_board_fold }
export type { FrameBounds }
