import type { PairFinding, PairLine, PairSide } from './review-pair-log'

// `josh review:pair --stats` (joshuafolkken/kit#8759): how many of the Opus reviewer's high and medium
// findings the paired Sonnet reviewer raised too, per severity, and each reviewer's mean cost per run.
// A Sonnet finding recalls an Opus one when it names the same file within LINE_TOLERANCE lines, at
// any severity; either side with no line number matches on the file alone. Each Sonnet finding recalls
// at most one Opus finding, high ones first. Sonnet is comparable when
// it recalls at least COMPARABLE_RECALL of the high and medium findings together.

const GRAVE_SEVERITIES = ['high', 'medium'] as const
const LINE_TOLERANCE = 10
const COMPARABLE_RECALL = 0.8
const PERCENT = 100
const USD_DIGITS = 2
const LOCATION_PATTERN = /^[^:]+:[^:]+:(?<file>[^:\s]+)(?::(?<line>\d+))?/u

const VERDICT = { COMPARABLE: 'comparable', SHORT: 'short', NO_DATA: 'no data' } as const

type Verdict = (typeof VERDICT)[keyof typeof VERDICT]

interface FindingLocation {
	file: string
	line: number | undefined
}

interface SeverityRecall {
	severity: string
	opus: number
	recalled: number
}

interface GraveMatch {
	severity: string
	recalled: boolean
}

interface PairStats {
	runs: number
	severities: ReadonlyArray<SeverityRecall>
	opus_usd: number | undefined
	sonnet_usd: number | undefined
}

function line_number(text: string | undefined): number | undefined {
	return text === undefined ? undefined : Number(text)
}

function location_of(finding: PairFinding): FindingLocation | undefined {
	const groups = LOCATION_PATTERN.exec(finding.line)?.groups
	const file = groups?.['file']

	return file === undefined ? undefined : { file, line: line_number(groups?.['line']) }
}

function is_near(opus: FindingLocation, sonnet: FindingLocation | undefined): boolean {
	if (sonnet?.file !== opus.file) return false
	if (opus.line === undefined || sonnet.line === undefined) return true

	return Math.abs(opus.line - sonnet.line) <= LINE_TOLERANCE
}

// Takes the first unused Sonnet location near the finding, so one Sonnet finding recalls one Opus finding.
function take_match(finding: PairFinding, unused: Array<FindingLocation | undefined>): boolean {
	const opus = location_of(finding)
	const index = opus === undefined ? -1 : unused.findIndex((other) => is_near(opus, other))

	if (index === -1) return false
	unused.splice(index, 1)

	return true
}

function grave_matches(line: PairLine): ReadonlyArray<GraveMatch> {
	const unused = line.sonnet.findings.map((finding) => location_of(finding))

	return GRAVE_SEVERITIES.flatMap((severity) =>
		line.opus.findings
			.filter((finding) => finding.severity === severity)
			.map((finding) => ({ severity, recalled: take_match(finding, unused) })),
	)
}

function severity_recall(matches: ReadonlyArray<GraveMatch>, severity: string): SeverityRecall {
	const rows = matches.filter((match) => match.severity === severity)

	return { severity, opus: rows.length, recalled: rows.filter((row) => row.recalled).length }
}

function sum_of(values: ReadonlyArray<number>): number {
	let sum = 0

	for (const value of values) sum += value

	return sum
}

function mean_usd(sides: ReadonlyArray<PairSide>): number | undefined {
	const priced = sides.map((side) => side.usd).filter((usd) => usd !== undefined)

	return priced.length === 0 ? undefined : sum_of(priced) / priced.length
}

function stats(lines: ReadonlyArray<PairLine>): PairStats {
	const matches = lines.flatMap((line) => grave_matches(line))

	return {
		runs: lines.length,
		severities: GRAVE_SEVERITIES.map((severity) => severity_recall(matches, severity)),
		opus_usd: mean_usd(lines.map((line) => line.opus)),
		sonnet_usd: mean_usd(lines.map((line) => line.sonnet)),
	}
}

function total(result: PairStats): SeverityRecall {
	return {
		severity: GRAVE_SEVERITIES.join('+'),
		opus: sum_of(result.severities.map((row) => row.opus)),
		recalled: sum_of(result.severities.map((row) => row.recalled)),
	}
}

function verdict(result: PairStats): Verdict {
	const all = total(result)

	if (all.opus === 0) return VERDICT.NO_DATA

	return all.recalled / all.opus >= COMPARABLE_RECALL ? VERDICT.COMPARABLE : VERDICT.SHORT
}

function percent(row: SeverityRecall): string {
	return row.opus === 0 ? '—' : `${String(Math.round((row.recalled / row.opus) * PERCENT))}%`
}

function row_line(row: SeverityRecall): string {
	return `${row.severity}: opus ${String(row.opus)} · sonnet recalled ${String(row.recalled)} · recall ${percent(row)}`
}

function dollars(usd: number | undefined): string {
	return usd === undefined ? '$?' : `$${usd.toFixed(USD_DIGITS)}`
}

function report(result: PairStats): ReadonlyArray<string> {
	const bar = `${String(COMPARABLE_RECALL * PERCENT)}% of high+medium, same file within ${String(LINE_TOLERANCE)} lines`

	return [
		`review:pair stats — ${String(result.runs)} runs`,
		...[...result.severities, total(result)].map((row) => row_line(row)),
		`cost per run: opus ${dollars(result.opus_usd)} · sonnet ${dollars(result.sonnet_usd)}`,
		`verdict: ${verdict(result)} (comparable at ${bar})`,
	]
}

const review_pair_stats = { dollars, report, stats, verdict, VERDICT }

export type { PairStats }
export { review_pair_stats }
