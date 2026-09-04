import { time_format } from '#scripts/time/time-format'
import { layer_checks } from './layer-checks'
import type { LayerScope, LayerStep } from './layer-step'

// Which checks run in more than one verification layer (joshuafolkken/kit#1313).
//
// The two readers beside this file answer *where* each command runs and *what* it checks; this one
// crosses them. A check appearing under two layer names is the repetition the report is for, and
// the scope column is what says how much of it is genuinely the same work — a hook that lints the
// staged files and a gate that lints the tree repeat each other only on those files.
//
// **The columns come from `time-format.ts`.** Three of that module's renderers already share it, and
// a fourth set of width rules beside a fourth renderer is the clone `CLAUDE.md` prohibits.

const SINGLE_LAYER = 1
const LAYER_COUNT_UNIT = 'layers'
const SINGLE_LAYER_UNIT = 'layer'

interface CheckLayerRow {
	layer: string
	scopes: ReadonlyArray<LayerScope>
	steps: ReadonlyArray<string>
}

interface CheckRow {
	check: string
	layers: ReadonlyArray<CheckLayerRow>
}

interface LayerReport {
	// Every layer that contributed at least one step, in the order they were read.
	layers: ReadonlyArray<string>
	repeated: ReadonlyArray<CheckRow>
	single: ReadonlyArray<CheckRow>
	// `josh` sub-commands appearing in the configuration that no check could be read from. Reported
	// rather than dropped: a hook rewired to a new target would otherwise vanish from the tables
	// with nothing to say it had.
	unresolved: ReadonlyArray<string>
}

// Generic rather than string-only so the scope column keeps its own union type instead of being
// asserted back into one.
function unique<T>(values: ReadonlyArray<T>): Array<T> {
	return [...new Set(values)]
}

function group_layer(steps: ReadonlyArray<LayerStep>): CheckLayerRow {
	return {
		layer: steps[0]?.layer ?? '',
		scopes: unique<LayerScope>(steps.map((step) => step.scope)),
		steps: steps.map((step) => step.step),
	}
}

// Steps that reach one check, split by the layer they sit in and kept in reading order.
function layers_of(steps: ReadonlyArray<LayerStep>): Array<CheckLayerRow> {
	return unique(steps.map((step) => step.layer)).map((layer) =>
		group_layer(steps.filter((step) => step.layer === layer)),
	)
}

// Most-repeated first, then alphabetically — so the row worth acting on is the first one read.
function by_layer_count(left: CheckRow, right: CheckRow): number {
	const difference = right.layers.length - left.layers.length

	return difference === 0 ? left.check.localeCompare(right.check) : difference
}

// One step and what it was found to check. Resolved once per step and carried, rather than asked
// for again by each of the two things that need it — the tables and the unresolved note.
interface ResolvedStep {
	step: LayerStep
	checks: ReadonlyArray<string>
	unresolved: ReadonlyArray<string>
}

function resolve_steps(steps: ReadonlyArray<LayerStep>): Array<ResolvedStep> {
	return steps.map((step) => ({ step, ...layer_checks.resolve_command(step.command) }))
}

function collect_rows(resolved: ReadonlyArray<ResolvedStep>): Array<CheckRow> {
	const found = unique(resolved.flatMap((entry) => entry.checks))

	return found.map((check) => ({
		check,
		layers: layers_of(
			resolved.filter((entry) => entry.checks.includes(check)).map((entry) => entry.step),
		),
	}))
}

function build_report(steps: ReadonlyArray<LayerStep>): LayerReport {
	const resolved = resolve_steps(steps)
	const rows = collect_rows(resolved).toSorted(by_layer_count)

	return {
		layers: unique(steps.map((step) => step.layer)),
		repeated: rows.filter((row) => row.layers.length > SINGLE_LAYER),
		single: rows.filter((row) => row.layers.length <= SINGLE_LAYER),
		unresolved: unique(resolved.flatMap((entry) => entry.unresolved)),
	}
}

function format_layer(row: CheckLayerRow): string {
	return `${row.layer} (${row.scopes.join(', ')})`
}

function count_label(layer_count: number): string {
	return layer_count === SINGLE_LAYER ? SINGLE_LAYER_UNIT : LAYER_COUNT_UNIT
}

function format_row(row: CheckRow): string {
	const count = `${String(row.layers.length)} ${count_label(row.layers.length)}`
	const where = row.layers.map((layer) => format_layer(layer)).join(time_format.SUFFIX_SEPARATOR)

	return time_format.format_columns(row.check, count, where)
}

function format_section(heading: string, rows: ReadonlyArray<CheckRow>): Array<string> {
	if (rows.length === 0) return []

	return [
		'',
		`  ${heading}`,
		...rows.slice(0, time_format.MAX_ROWS).map((row) => format_row(row)),
		...time_format.overflow_line(rows.length),
	]
}

function report_notes(report: LayerReport): Array<string> {
	if (report.unresolved.length === 0) return []

	return time_format.note_lines([`unresolved josh commands: ${report.unresolved.join(', ')}`])
}

function format_report(report: LayerReport): Array<string> {
	return [
		`Verification layers — ${String(report.layers.length)} read: ${report.layers.join(', ')}`,
		...format_section('Repeated across layers', report.repeated),
		...format_section('One layer only', report.single),
		...(report.unresolved.length === 0 ? [] : ['']),
		...report_notes(report),
	]
}

const layer_report = { build_report, format_report }

export type { CheckLayerRow, CheckRow, LayerReport }
export { layer_report }
