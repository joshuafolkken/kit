import type { GateEntry, LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_stats } from '#scripts/lane/lane-stats'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// The duration half of `josh metrics`: the gate, the unit suite, and the
// startup of josh and of the guard hook every tool call runs. Performance work waits for a measured
// problem, so the measurement itself runs on every gate and a slowdown fails it.
//
// **A tolerance of +10%, where the static totals have none.** A count read off a tree is the same on
// every run; a duration is not, so only a slowdown past the noise fails.
//
// **Only like is compared with like.** A duration measured under another gate's load, or any other
// work's, is the load's, so the gate and unit durations come from solo gates alone, and the startups
// are timed only outside a gate (`metrics-command.ts`).
//
// **The baseline never moves down on its own.** One quiet run would otherwise set a bar the next
// ordinary one misses; a speedup is recorded with `--accept`, as a raise is.
//
// **The baseline is one machine's.** Durations from two machines do not compare, so the values live
// beside the repository's git directory, never in the tree — `docs/josh-commands.md` → "josh metrics".

const TOLERANCE_PERCENT = 10
const PERCENT = 100
// The solo gates the gate and unit durations are the median of — enough to step over one gate slowed
// by other work on the machine (a review, a related test run), few enough to follow a real change
// within a day.
const RECENT_GATES = 5
// The gates after a fix that still read slow: until the fixed gates are the window's majority.
const HALVES = 2
const TRAILING_GATES = Math.floor(RECENT_GATES / HALVES) + 1
const MS_PER_SECOND = 1000
const SECONDS_DIGITS = 1
const NEWLINE = '\n'
const JSON_INDENT = '\t'
const MISSING = '—'
const SEPARATOR = ' · '

const RECORDED_NAMES = ['gate', 'unit'] as const
const DURATION_NAMES = [...RECORDED_NAMES, 'josh_startup', 'guard_startup'] as const

type DurationName = (typeof DURATION_NAMES)[number]
// `undefined` is a duration that was not measured — no solo gate yet, a startup that failed.
type Durations = Partial<Record<DurationName, number | undefined>>

const baseline_schema = z.record(z.string(), z.number())

// A duration against this machine's recorded one. The totals' own change (`metrics-ratchet.ts`) is a
// different shape: it is measured from the merge-base and carries the growth an approval covers.
interface DurationChange {
	name: string
	baseline: number
	current: number
}

interface DurationVerdict {
	regressions: ReadonlyArray<DurationChange>
	// The baseline with every duration it did not hold yet — a first measurement on this machine is
	// the bar, not a regression.
	baseline: Durations
	is_extended: boolean
}

interface GateSpan {
	entry: GateEntry
	start_ms: number
	end_ms: number
}

interface GateSample {
	elapsed_ms: number
	unit_ms: number
}

function present(durations: Durations): ReadonlyArray<[DurationName, number]> {
	return DURATION_NAMES.flatMap((name): Array<[DurationName, number]> => {
		const value = durations[name]

		return value === undefined ? [] : [[name, value]]
	})
}

// `base` with every duration `top` measured — one `top` left unmeasured keeps `base`'s value.
function overlay(base: Durations, top: Durations): Durations {
	return { ...base, ...Object.fromEntries(present(top)) }
}

function parse_baseline(text: string): Durations {
	const parsed = baseline_schema.safeParse(json_value.parse_or_undefined(text))

	return parsed.success ? Object.fromEntries(present(parsed.data)) : {}
}

function is_regression(change: DurationChange): boolean {
	return change.current * PERCENT > change.baseline * (PERCENT + TOLERANCE_PERCENT)
}

function compare(baseline: Durations, current: Durations): DurationVerdict {
	const changes = present(current).map(([name, value]) => ({
		name,
		baseline: baseline[name] ?? value,
		current: value,
	}))

	return {
		regressions: changes.filter((change) => is_regression(change)),
		baseline: { ...current, ...baseline },
		is_extended: present(current).some(([name]) => baseline[name] === undefined),
	}
}

// A gate entry is written when the gate ends, so it starts `elapsed_ms` before its `at`.
function gate_span(entry: GateEntry): GateSpan {
	const end_ms = Date.parse(entry.at)

	return { entry, start_ms: end_ms - entry.elapsed_ms, end_ms }
}

function gate_spans(entries: ReadonlyArray<LedgerEntry>): ReadonlyArray<GateSpan> {
	return entries
		.filter((entry): entry is GateEntry => entry.kind === 'gate')
		.map((entry) => gate_span(entry))
}

function is_overlapped(span: GateSpan, other: GateSpan): boolean {
	return other !== span && other.start_ms < span.end_ms && span.start_ms < other.end_ms
}

// A quiet gate ran beside no whole core of other work at its start or its end:
// another lane's lint, related tests or `ship` are no gate, yet doubled a solo gate's duration. A gate
// whose load was never read — an older line, a machine that could not be read — is not known quiet.
function is_quiet(entry: GateEntry): boolean {
	return entry.external_cores === 0
}

// A solo gate: no other gate in this repository ran at any point between its start and its end — a
// failed one included, since it loaded the machine as much — and the machine was quiet besides. The
// overlap is read off the gates' own spans rather than the count of open lanes, which run gates far
// less often than they exist.
function is_solo(span: GateSpan, spans: ReadonlyArray<GateSpan>): boolean {
	return is_quiet(span.entry) && spans.every((other) => !is_overlapped(span, other))
}

// A failed gate is a sample as well: every check runs to completion whether it passes, so it timed the
// same work — and a gate this step fails on a slowdown must still count, or the slow median would
// hold every later gate red after the slowdown is fixed.
function sample(span: GateSpan, spans: ReadonlyArray<GateSpan>): ReadonlyArray<GateSample> {
	const { elapsed_ms, unit_ms } = span.entry

	if (unit_ms === undefined) return []

	return is_solo(span, spans) ? [{ elapsed_ms, unit_ms }] : []
}

// The median of the last solo gates that ran the unit suite. A `--no-unit` gate is left out: it timed
// a different set of checks. Fewer than `RECENT_GATES` reads as not measured, so the first baseline is
// the median of as many gates as every later reading.
function from_ledger(entries: ReadonlyArray<LedgerEntry>): Durations {
	const spans = gate_spans(entries)
	const gates = spans.flatMap((span) => sample(span, spans)).slice(-RECENT_GATES)

	if (gates.length < RECENT_GATES) return { gate: undefined, unit: undefined }

	return {
		gate: lane_stats.median(gates.map((entry) => entry.elapsed_ms)),
		unit: lane_stats.median(gates.map((entry) => entry.unit_ms)),
	}
}

function format(value: number | undefined): string {
	if (value === undefined) return MISSING
	if (value < MS_PER_SECOND) return `${String(Math.round(value))}ms`

	return `${(value / MS_PER_SECOND).toFixed(SECONDS_DIGITS)}s`
}

// Without the startups, the gate's step leaves them out rather than printing a dash it never measured.
function render(durations: Durations, is_startup_timed: boolean): string {
	const names = is_startup_timed ? DURATION_NAMES : RECORDED_NAMES
	const cells = names.map((name) => `${name} ${format(durations[name])}`)

	return `durations  ${cells.join(SEPARATOR)}`
}

function render_regressions(
	regressions: ReadonlyArray<DurationChange>,
	baseline_path: string,
): string {
	const over = `more than ${String(TOLERANCE_PERCENT)}% over the baseline`

	return [
		`josh metrics: ${String(regressions.length)} duration(s) ${over} in ${baseline_path}:`,
		...regressions.map(
			(change) =>
				`  ${change.name}  baseline ${format(change.baseline)} → current ${format(change.current)}`,
		),
		`gate and unit trail a fix by up to ${String(TRAILING_GATES)} gates (the median of the last ${String(RECENT_GATES)} solo ones) — rerun the gate before accepting them.`,
		'Find what slowed it, or record the current durations: pnpm josh metrics --accept --reason "<why>"',
	].join(NEWLINE)
}

function baseline_text(durations: Durations): string {
	const rounded = present(durations).map(([name, value]) => [name, Math.round(value)])

	return `${JSON.stringify(Object.fromEntries(rounded), undefined, JSON_INDENT)}${NEWLINE}`
}

const metrics_durations = {
	baseline_text,
	compare,
	from_ledger,
	overlay,
	parse_baseline,
	render,
	render_regressions,
}

export type { DurationName, Durations, DurationVerdict }
export { metrics_durations }
