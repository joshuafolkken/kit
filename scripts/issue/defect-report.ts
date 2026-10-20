import { defect_origin_line } from './defect-origin-line'

// Defects grouped by the pull request each one's origin line names: how many per pull request, per
// change kind, and per area of the tree it touched, plus how many each pull request that added a
// mechanism drew within a week of merging. Read from the bodies and the pull requests' files only,
// so nothing here asks for a judgement.

const WEEK_DAYS = 7
const MS_PER_DAY = 86_400_000
const WEEK_MS = WEEK_DAYS * MS_PER_DAY
const SCRIPTS_ROOT = 'scripts'
// `scripts/<dir>` — the two leading segments of a path under `scripts/`.
const SCRIPT_AREA_DEPTH = 2
const ROOT_AREA = '(root)'
const UNREAD_AREA = '(pull request not read)'
const TEST_FILE = /\.(?:test|e2e)\.ts$|\.snap$/u
// The run's own records — observations, accepted metrics — which nearly every merge adds, so they
// say nothing about what the pull request changed.
const RUN_RECORD_ROOT = '.josh/'

type ChangeKind = 'add' | 'fix' | 'remove'

interface ReportIssue {
	number: number
	created_at: string
	body: string
}

interface PrFile {
	filename: string
	status: string
	additions: number
	deletions: number
}

interface OriginPr {
	pr: number
	merged_at: string
	kind: ChangeKind
	areas: ReadonlyArray<string>
}

interface Attributed {
	issue: ReportIssue
	pr: number
}

interface DefectReport {
	by_pr: ReadonlyMap<number, number>
	by_kind: ReadonlyMap<string, number>
	by_area: ReadonlyMap<string, number>
	unknown: number
	undeclared: number
	added_within_week: ReadonlyMap<number, number>
}

function changed(files: ReadonlyArray<PrFile>): ReadonlyArray<PrFile> {
	return files.filter((file) => !file.filename.startsWith(RUN_RECORD_ROOT))
}

// A pull request that brought in a new non-test file added a mechanism; one that took out more than it
// put in removed; anything else changed what was there.
function change_kind(files: ReadonlyArray<PrFile>): ChangeKind {
	const source = changed(files).filter((file) => !TEST_FILE.test(file.filename))

	if (source.some((file) => file.status === 'added')) return 'add'

	const added = source.reduce((sum, file) => sum + file.additions, 0)
	const removed = source.reduce((sum, file) => sum + file.deletions, 0)

	return removed > added ? 'remove' : 'fix'
}

// `scripts/<dir>` for a script, the top-level directory otherwise, and one bucket for root files.
function area_of(filename: string): string {
	const segments = filename.split('/')

	if (segments.length === 1) return ROOT_AREA

	const is_script = segments[0] === SCRIPTS_ROOT && segments.length > SCRIPT_AREA_DEPTH
	const depth = is_script ? SCRIPT_AREA_DEPTH : 1

	return segments.slice(0, depth).join('/')
}

function areas(files: ReadonlyArray<PrFile>): ReadonlyArray<string> {
	return [...new Set(changed(files).map((file) => area_of(file.filename)))]
}

function increment<K>(counts: Map<K, number>, key: K): void {
	counts.set(key, (counts.get(key) ?? 0) + 1)
}

function count_by<K>(
	items: ReadonlyArray<Attributed>,
	keys: (item: Attributed) => ReadonlyArray<K>,
): Map<K, number> {
	const counts = new Map<K, number>()

	for (const item of items) for (const key of keys(item)) increment(counts, key)

	return counts
}

function within_week(issue: ReportIssue, origin: OriginPr): boolean {
	const elapsed = Date.parse(issue.created_at) - Date.parse(origin.merged_at)

	return elapsed >= 0 && elapsed <= WEEK_MS
}

function attribute(issue: ReportIssue): Attributed | undefined {
	const origin = defect_origin_line.parse(issue.body)

	return origin?.kind === 'pr' ? { issue, pr: origin.pr } : undefined
}

function attributed(issues: ReadonlyArray<ReportIssue>): ReadonlyArray<Attributed> {
	return issues.map((issue) => attribute(issue)).filter((item) => item !== undefined)
}

// Every pull request an origin line names, once — what the report has to read.
function origin_prs(issues: ReadonlyArray<ReportIssue>): ReadonlyArray<number> {
	return [...new Set(attributed(issues).map(({ pr }) => pr))]
}

function soon_after_adding(
	items: ReadonlyArray<Attributed>,
	prs: ReadonlyMap<number, OriginPr>,
): Map<number, number> {
	return count_by(items, ({ issue, pr }) => {
		const origin = prs.get(pr)

		return origin?.kind === 'add' && within_week(issue, origin) ? [pr] : []
	})
}

function count_origins(issues: ReadonlyArray<ReportIssue>, kind: 'unknown' | undefined): number {
	return issues.filter((issue) => defect_origin_line.parse(issue.body)?.kind === kind).length
}

function aggregate(
	issues: ReadonlyArray<ReportIssue>,
	prs: ReadonlyMap<number, OriginPr>,
): DefectReport {
	const items = attributed(issues)

	return {
		by_pr: count_by(items, ({ pr }) => [pr]),
		by_kind: count_by(items, ({ pr }) => [prs.get(pr)?.kind ?? UNREAD_AREA]),
		by_area: count_by(items, ({ pr }) => prs.get(pr)?.areas ?? [UNREAD_AREA]),
		unknown: count_origins(issues, 'unknown'),
		undeclared: count_origins(issues, undefined),
		added_within_week: soon_after_adding(items, prs),
	}
}

const defect_report = { aggregate, area_of, areas, change_kind, origin_prs, WEEK_DAYS }

export type { ChangeKind, DefectReport, OriginPr, PrFile, ReportIssue }
export { defect_report }
