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
// Written as the condition rather than as a verdict: the skip holds for the tree the gate's record
// covers, and a reader who has edited since is looking at a layer that will run the check after all.
//
// **"the gate record covers this tree" rather than "the gate is green"** — a green gate is one of
// four conditions `hook-gate-reuse.ts` requires, alongside the file map matching, the base commit
// matching and the escape hatch being unset. The record covering the tree is the umbrella all of them
// narrow, so the note claims exactly what the hook checks rather than the loosest of its parts.
const GATE_SKIP_NOTE = 'skipped where the gate record covers this tree'

interface CheckLayerRow {
	layer: string
	scopes: ReadonlyArray<LayerScope>
	steps: ReadonlyArray<string>
	// Whether a green gate lets every step behind this row decline the check (joshuafolkken/kit#1786).
	// A row carrying it is not the repetition the layer count makes it look like.
	is_gate_skipped: boolean
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

// **`every` rather than `some`.** A row groups every step of one layer that reaches one check, so
// the check is only skipped there when all of them are — one step still running it means the layer
// still runs it, and a row that said otherwise would under-report the very duplication this report
// exists to find.
function group_layer(steps: ReadonlyArray<LayerStep>): CheckLayerRow {
	return {
		layer: steps[0]?.layer ?? '',
		scopes: unique<LayerScope>(steps.map((step) => step.scope)),
		steps: steps.map((step) => step.step),
		is_gate_skipped: steps.every((step) => layer_checks.is_gate_skipped(step.command)),
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

// The note sits inside the same parentheses as the scope, because it qualifies the same thing: how
// much of this layer's run is genuinely the repeated work the count above it claims.
function format_layer(row: CheckLayerRow): string {
	const qualifiers: Array<string> = [...row.scopes]
	if (row.is_gate_skipped) qualifiers.push(GATE_SKIP_NOTE)

	return `${row.layer} (${qualifiers.join(', ')})`
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
