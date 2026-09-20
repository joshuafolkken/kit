import {
	package_scout,
	type PackageMetrics,
	type RankedTable,
	type TierVerdict,
} from './package-scout'

// The printed shape of `josh pkg:scout` — one line per candidate with each metric labelled, then a
// verdict line that names whether the choice is a Tier A pick or a Tier B question
// (joshuafolkken/kit#2216). Formatting is pure so the layout and the verdict wording are unit-tested
// without a registry.

// The blank shown for a metric the registry did not report — a fact absent, never a zero measured.
const UNKNOWN = '—'
// The rank marker (`#1`) is padded to this width so the names after it line up.
const RANK_WIDTH = 4
// The column the package name is padded to, so the labelled metrics after it line up down the table.
const NAME_WIDTH = 28
// Score is printed to two decimals; the near-tie gap is a fraction shown as a whole-number percent.
const SCORE_DIGITS = 2
const PERCENT = 100
// The number of characters an ISO timestamp carries before the time — `2025-08-01T…` → `2025-08-01`.
const DATE_LENGTH = 10

// Binary units: the registry reports `dist.unpackedSize` in bytes, and package sizes are read in KiB
// and MiB in practice.
const BYTE_STEP = 1024
const SIZE_UNITS: ReadonlyArray<string> = ['B', 'KB', 'MB', 'GB']
const SIZE_DIGITS = 1
// Digits are grouped in threes from the right — 12345 → 12,345.
const GROUP_SIZE = 3

// Thousands grouping without Intl, so the output does not vary with the runtime's ICU data, and
// without a look-ahead regex, whose backtracking is super-linear.
function group_thousands(value: number): string {
	const text = String(value)
	const groups: Array<string> = []

	for (let end = text.length; end > 0; end -= GROUP_SIZE) {
		groups.unshift(text.slice(Math.max(0, end - GROUP_SIZE), end))
	}

	return groups.join(',')
}

function format_downloads(weekly: number | undefined): string {
	return weekly === undefined ? UNKNOWN : `${group_thousands(weekly)}/wk`
}

function format_date(published: string | undefined): string {
	return published === undefined ? UNKNOWN : published.slice(0, DATE_LENGTH)
}

// Step down to the largest unit the size does not overflow, capped at the last unit for anything huge.
function scale_bytes(bytes: number): readonly [number, number] {
	let value = bytes
	let index = 0

	while (value >= BYTE_STEP && index < SIZE_UNITS.length - 1) {
		value /= BYTE_STEP
		index += 1
	}

	return [value, index]
}

function format_size(bytes: number | undefined): string {
	if (bytes === undefined) return UNKNOWN

	const [value, index] = scale_bytes(bytes)
	const digits = index === 0 ? 0 : SIZE_DIGITS

	return `${value.toFixed(digits)} ${SIZE_UNITS[index] ?? 'B'}`
}

function format_row(index: number, metrics: PackageMetrics): string {
	const name = `${metrics.name}@${metrics.version}`

	return [
		`#${String(index + 1)}`.padEnd(RANK_WIDTH),
		name.padEnd(NAME_WIDTH),
		`score ${metrics.score.toFixed(SCORE_DIGITS)}`,
		`dl ${format_downloads(metrics.weekly_downloads)}`,
		`pub ${format_date(metrics.last_publish)}`,
		`types ${metrics.has_bundled_types ? '✓' : '✗'}`,
		`lic ${metrics.license ?? UNKNOWN}`,
		`size ${format_size(metrics.install_size_bytes)}`,
	].join('  ')
}

const NO_CANDIDATES_LINE = 'Candidates: none — no package on the registry matched these keywords.'

function format_percent(fraction: number): string {
	return `${String(Math.round(fraction * PERCENT))}%`
}

// A lone candidate has nothing to be close to, so it is the pick by default — the verdict vocabulary
// still reads `clear` so a caller keys off one word rather than counting rows.
function format_single(metrics: PackageMetrics): string {
	return `Tier: clear — only ${metrics.name} matched; it is the pick (Tier A).`
}

function name_or_blank(metrics: PackageMetrics | undefined): string {
	return metrics?.name ?? ''
}

function lead_line(table: RankedTable): string {
	const [first, second] = table.ranked
	const names = `${name_or_blank(first)} leads ${name_or_blank(second)}`

	return `${names} by ${format_percent(table.gap ?? 0)}`
}

function format_pair(table: RankedTable, verdict: TierVerdict): string {
	const threshold = format_percent(package_scout.NEAR_TIE_THRESHOLD)
	const lead = lead_line(table)

	if (verdict === 'clear') return `Tier: clear — ${lead} (≥ ${threshold}); select it (Tier A).`

	return `Tier: close — ${lead} (< ${threshold}); ask the user (Tier B).`
}

function format_verdict(table: RankedTable): string {
	const [first] = table.ranked

	if (first === undefined) return NO_CANDIDATES_LINE
	if (table.verdict === undefined) return format_single(first)

	return format_pair(table, table.verdict)
}

function format_table(table: RankedTable): string {
	if (table.ranked.length === 0) return NO_CANDIDATES_LINE

	const rows = table.ranked.map((metrics, index) => format_row(index, metrics))

	return [...rows, '', format_verdict(table)].join('\n')
}

const package_scout_format = {
	NO_CANDIDATES_LINE,
	group_thousands,
	format_downloads,
	format_date,
	format_size,
	format_row,
	format_verdict,
	format_table,
}

export { package_scout_format }
