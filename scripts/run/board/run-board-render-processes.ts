import { run_board_fit, type DetailPart } from './run-board-fit'
import type { BoardHeader, BoardUsage } from './run-board-header'
import type { NamedFigure, ProcessGroups } from './run-board-process-groups'
import { run_board_render_lanes } from './run-board-render-lanes'
import { run_board_render_section } from './run-board-render-section'
import { run_board_render_title } from './run-board-render-title'
import type { UsageFigure, UsageScale } from './run-board-usage'
import { run_board_usage_text } from './run-board-usage-text'

// What is loading the machine, by who started it: the backlogrun's own processes — its supervisor, the
// parent session and the lanes — the apps outside it, and whatever a run left behind. On a terminal
// one row each with gauges under a rule whose labels stand over them, the parts of each group indented
// under it so a short pane can drop them first; anywhere else one line of figures.

const { LANES_LABEL, column_cells, label_columns, lead_width } = run_board_render_lanes
const { columns_rule, heading_lines } = run_board_render_section
const { title_of } = run_board_render_title
const { plain_of } = run_board_usage_text
const GAUGE = 5
const CELL_GAP = ' '
const INDENT = '  '
const DETAIL = '  '
const NAME_LIMIT = 24
// Icons Unicode draws as emoji by default, which `string-width` counts two columns wide as a terminal
// draws them: 🖥 and 🎛, text symbols drawn as emoji, overlapped the blank after them.
const LABEL = '💻 processes'
const PART_GAP = ' · '
const LABELS = {
	backlogrun: '▶ backlogrun',
	supervisor: '🧭 supervisor',
	parent: '🎬 parent',
	lanes: LANES_LABEL,
	apps: '🌐 apps',
	leftover: '👻 leftover',
}

interface Labeled {
	label: string
	figure: UsageFigure
	is_detail: boolean
}

function count_of(instances: number): string {
	return instances > 1 ? ` ×${String(instances)}` : ''
}

function named(entry: NamedFigure): Labeled {
	const label = `${title_of(entry.name, NAME_LIMIT)}${count_of(entry.instances)}`

	return { label, figure: entry.figure, is_detail: true }
}

// A group's line and its parts' lines, the parts only where it has any.
function group_of(
	label: string,
	figure: UsageFigure,
	parts: ReadonlyArray<Labeled>,
): Array<Labeled> {
	return [{ label, figure, is_detail: false }, ...parts]
}

function named_group(
	label: string,
	figure: UsageFigure,
	entries: ReadonlyArray<NamedFigure>,
): Array<Labeled> {
	return group_of(
		label,
		figure,
		entries.map((entry) => named(entry)),
	)
}

function backlogrun_group(backlogrun: ProcessGroups['backlogrun']): Array<Labeled> {
	const lanes = `${LABELS.lanes}${count_of(backlogrun.lanes.count)}`
	const own = [
		{ label: LABELS.supervisor, figure: backlogrun.supervisor, is_detail: true },
		{ label: LABELS.parent, figure: backlogrun.parent, is_detail: true },
		{ label: lanes, figure: backlogrun.lanes.figure, is_detail: true },
	]

	return group_of(LABELS.backlogrun, backlogrun.total, own)
}

// The leftover group is drawn only where a run left something behind.
function labeled_of(usage: BoardUsage): Array<Labeled> {
	const { backlogrun, apps, leftover } = usage.processes
	const left =
		leftover.entries.length === 0
			? []
			: named_group(LABELS.leftover, leftover.total, leftover.entries)

	return [
		...backlogrun_group(backlogrun),
		...named_group(LABELS.apps, apps.total, apps.top),
		...left,
	]
}

function label_text(entry: Labeled): string {
	return entry.is_detail ? `${DETAIL}${entry.label}` : entry.label
}

function padded(text: string, width: number): string {
	return `${text}${' '.repeat(Math.max(0, width - run_board_fit.width_of(text)))}`
}

function screen_part(usage: BoardUsage): DetailPart {
	const entries = labeled_of(usage)
	const widest = Math.max(...entries.map((entry) => run_board_fit.width_of(label_text(entry))))
	const label_width = lead_width(widest, LABEL, INDENT.length)
	const lines = entries.map((entry) => {
		const cells = column_cells(entry.figure, usage.scale, GAUGE)

		return {
			text: `${INDENT}${padded(label_text(entry), label_width)}${CELL_GAP}${cells}`,
			is_detail: entry.is_detail,
		}
	})

	const columns = label_columns(INDENT.length + label_width + CELL_GAP.length, GAUGE)

	return { head: ['', columns_rule(LABEL, columns)], lines }
}

function plain_group(
	scale: UsageScale,
	label: string,
	figure: UsageFigure,
	parts: ReadonlyArray<NamedFigure>,
): string {
	const group = `${label} ${plain_of(figure, scale)}`
	const named_parts = parts.map((part) => `${named(part).label} ${plain_of(part.figure, scale)}`)

	return named_parts.length === 0 ? group : `${group}: ${named_parts.join(', ')}`
}

// The groups on one line: `▶ backlogrun 44.5%/4.0G/3.3G · 🌐 apps 28.2%/18.8G/12.4G: Chrome …`.
function plain_part(usage: BoardUsage): DetailPart {
	const { processes, scale } = usage
	const { backlogrun, apps, leftover } = processes
	const groups = [
		plain_group(scale, LABELS.backlogrun, backlogrun.total, []),
		plain_group(scale, LABELS.apps, apps.total, apps.top),
	]
	const left =
		leftover.entries.length === 0
			? []
			: [plain_group(scale, LABELS.leftover, leftover.total, leftover.entries)]
	const text = `${INDENT}${[...groups, ...left].join(PART_GAP)}`

	return { head: heading_lines(LABEL), lines: [{ text, is_detail: false }] }
}

// `undefined` where the frame read no usage.
function processes_part(header: BoardHeader): DetailPart | undefined {
	const { usages } = header

	if (usages === undefined) return undefined

	return header.spinner === undefined ? plain_part(usages) : screen_part(usages)
}

const run_board_render_processes = { processes_part }

export { run_board_render_processes }
