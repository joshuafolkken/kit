import { codex_hooks } from '#scripts/agent/codex-hooks'
import { git_path_quoting } from '#scripts/git/git-path-quoting'
import { issue_body_keys } from '#scripts/issue/issue-body-keys'
import { run_record_path } from '#scripts/josh/run-record-path'
import { lane_implement_rate, type ImplementRate } from '#scripts/lane/lane-implement-rate'
import type { SizeRatios } from '#scripts/lane/lane-size-stats'
import { test_declared_logic } from '#scripts/test/test-declared-logic'
import { declared_growth } from './declared-growth'

// The size half of the split assessment, measured rather than estimated.
//
// `split-assessment.md` → "The question" asks two things, and only the second is mechanical: does the
// change exceed what one verification gate confirms in one pass, the guide being more than
// `FILE_GUIDE` changed files or more than `LINE_GUIDE` changed lines, test files excluded. The first — are there two or more
// separately-mergeable deliverables — stays a judgement, so this answers the size question alone and
// never claims to have decided the split.
//
// Counting excludes run records via `run_record_path` and test files via `test_declared_logic.is_test_file`. The
// "test files excluded" clause in the guide and the `*.test.ts` / `*.e2e.ts` spelling are one fact;
// a second copy here would let the two drift.

type SplitVerdict = 'split' | 'single'

// One file's contribution to the change size: its path, and the lines it added plus the lines it
// removed. A binary file, which `git diff --numstat` prints as `-`, contributes zero changed lines.
interface FileChange {
	path: string
	changed_lines: number
}

interface SizeMeasurement {
	files: number
	lines: number
	verdict: SplitVerdict
	guide?: SplitGuide
}

// A size as an Issue declares it, or as a bar a measurement is compared with.
interface DeclaredSize {
	files: number
	lines: number
}

interface SplitGuide extends DeclaredSize {
	cap: DeclaredSize
	growth?: SizeRatios
}

// The guide's single source: `split-assessment.md` states these once and a test pins the two equal.
// Strictly greater than: "more than" puts the bar above the number, not at it. Lowered from 10 / 400
// once a lane estimated at 6 files / 250 lines merged at about 23 files / 390 lines (joshuafolkken/kit#5384).
const FILE_GUIDE = 8
const LINE_GUIDE = 200
// The cap, one and a half times the guide: past it a declared reason no longer keeps an Issue as one. A
// lane declared past it with a reason overran both its time budget and its declared files by far
// (joshuafolkken/kit#5502). Lowered from 3 once the projected implement time became the main bar — the
// cap is the backstop where no rate is measured (joshuafolkken/kit#6066).
const CAP_FACTOR = 1.5
const FILE_CAP = FILE_GUIDE * CAP_FACTOR
const LINE_CAP = LINE_GUIDE * CAP_FACTOR
const DEFAULT_GUIDE: SplitGuide = {
	files: FILE_GUIDE,
	lines: LINE_GUIDE,
	cap: { files: FILE_CAP, lines: LINE_CAP },
}

// Keep fractional thresholds: rounding would change the budget's strict comparison boundary.
function guide_for(minutes: number, measured?: ImplementRate, growth?: SizeRatios): SplitGuide {
	const lines = lane_implement_rate.lines_for(minutes, measured)
	const correction = growth === undefined ? {} : { growth }

	if (lines === undefined || lines <= LINE_GUIDE) return { ...DEFAULT_GUIDE, ...correction }
	const files = (lines * FILE_GUIDE) / LINE_GUIDE

	return {
		files,
		lines,
		cap: { files: files * CAP_FACTOR, lines: lines * CAP_FACTOR },
		...correction,
	}
}

// Compatibility name for the unmeasured-axis fallback; the guide carries measured growth.
const DECLARED_GROWTH_FACTOR = declared_growth.FALLBACK

const SPLIT_VERDICT: SplitVerdict = 'split'
const SINGLE_VERDICT: SplitVerdict = 'single'

const SCRIPTS_DIRECTORY = 'scripts/'
const TYPESCRIPT = '.ts'

const BINARY_MARKER = '-'
const NUMSTAT_FIELDS = 3

// A `-` count (binary file), or a missing field, reads as zero; anything else is coerced to a
// number, and an unparseable field also reads as zero rather than throwing on a row this was not
// meant to size.
function parse_count(field: string | undefined): number {
	if (field === undefined || field === BINARY_MARKER) return 0

	const value = Number(field)

	return Number.isNaN(value) ? 0 : value
}

// One `added\tdeleted\tpath` row into a `FileChange`, or `undefined` for a row that is not one.
function parse_row(row: string): FileChange | undefined {
	const fields = row.split('\t')

	if (fields.length < NUMSTAT_FIELDS) return undefined

	const [added, deleted, ...path_parts] = fields

	return { path: path_parts.join('\t'), changed_lines: parse_count(added) + parse_count(deleted) }
}

// The raw stdout of `git diff --numstat` into the changes it lists.
function parse_numstat(raw: string): Array<FileChange> {
	return raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.map((row) => parse_row(row))
		.filter((change): change is FileChange => change !== undefined)
}

function is_deliverable(change: FileChange): boolean {
	const file = git_path_quoting.unquote(change.path)

	return !test_declared_logic.is_test_file(file) && !run_record_path.is_run_record(file)
}

function is_scripts_module(file: string): boolean {
	return file.startsWith(SCRIPTS_DIRECTORY) && file.endsWith(TYPESCRIPT)
}

function directory_of(file: string): string {
	return file.slice(0, file.lastIndexOf('/') + 1)
}

// Each added module beside the first free listed module of its directory that is not added, both ways
// round — matched by directory, not list order, so an unrelated file listed first does not take the pair.
function partners_of(
	files: ReadonlyArray<string>,
	added: ReadonlySet<string>,
): Map<string, string> {
	const modules = files.filter((file) => is_scripts_module(file))
	const partners = new Map<string, string>()
	const new_modules = modules.filter((file) => added.has(file))

	for (const module of new_modules) {
		const importer = modules.find(
			(file) =>
				!added.has(file) && !partners.has(file) && directory_of(file) === directory_of(module),
		)
		if (importer !== undefined) partners.set(module, importer).set(importer, module)
	}

	return partners
}

// The files grouped into what splits as one, each group at its first file: a new scripts module and an
// importer of its directory count as one (joshuafolkken/kit#6635), for `lane:plan` and the split notice
// alike (joshuafolkken/kit#6724). A registered generated artifact also stays with its source (#7381);
// the two files' changed lines still count in full. Other files stand alone when none is added.
function units_of(files: ReadonlyArray<string>, added: ReadonlySet<string>): Array<Array<string>> {
	const artifacts = codex_hooks.GENERATED_SOURCES
	const sources = files.filter((file) => !files.includes(artifacts.get(file) ?? ''))
	const partners = partners_of(sources, added)

	return sources.flatMap((file) => {
		const partner = partners.get(file)
		const unit = partner === undefined ? [file] : [file, partner]
		const generated = files.filter((path) => unit.includes(artifacts.get(path) ?? ''))

		return partner !== undefined && sources.indexOf(partner) < sources.indexOf(file)
			? []
			: [[...unit, ...generated]]
	})
}

// `split` when **either** guide is exceeded — the AND form never fired, even on the lanes cut twice
// mid-implementation (joshuafolkken/kit#5384). A filing's declared estimate and `backlog:next`'s offer
// are judged by this same call (`issue/size-estimate.ts`).
function verdict_for(
	files: number,
	lines: number,
	guide: SplitGuide = DEFAULT_GUIDE,
): SplitVerdict {
	return files > guide.files || lines > guide.lines ? SPLIT_VERDICT : SINGLE_VERDICT
}

// Strictly greater than, as the guide is: the cap itself still runs as one Issue.
function is_over_cap(files: number, lines: number, guide: SplitGuide = DEFAULT_GUIDE): boolean {
	return files > guide.cap.files || lines > guide.cap.lines
}

// `added` lists the files the branch adds, so a new module and its importer count as one file.
function measure(
	changes: ReadonlyArray<FileChange>,
	guide?: SplitGuide,
	added: ReadonlySet<string> = new Set(),
): SizeMeasurement {
	const runtime = changes.filter((change) => is_deliverable(change))
	const lines = runtime.reduce((total, change) => total + change.changed_lines, 0)
	const paths = runtime.map((change) => git_path_quoting.unquote(change.path))
	const files = units_of(paths, added).length

	return {
		files,
		lines,
		verdict: verdict_for(files, lines, guide),
		...(guide !== undefined && { guide }),
	}
}

// The size measurement of a raw `git diff --numstat`, the one call the CLI makes.
function assess(raw: string, guide?: SplitGuide, added?: ReadonlySet<string>): SizeMeasurement {
	return measure(parse_numstat(raw), guide, added)
}

const SPLIT_TAIL =
	'over the guide — the size condition for a split is met (separability is a separate judgement)'
const SINGLE_TAIL = 'under the guide on both axes — one Issue, however separable'

// What was counted. Test files are already dropped from the counts, so the text says so.
function counted(measurement: SizeMeasurement): string {
	return `${String(measurement.files)} changed file(s), ${String(measurement.lines)} changed line(s), tests excluded`
}

function guide_text(guide: SplitGuide): string {
	return `guide ${String(guide.files)} files / ${String(guide.lines)} lines`
}

function policy_text(guide: SplitGuide): string {
	const source = guide.lines > LINE_GUIDE ? 'measured' : 'fallback'

	return `${guide_text(guide)} (${source}); ${declared_growth.text(guide.growth)}`
}

// The sentence printed on stderr: what was counted, against which guide, and what the verdict does
// and does not mean.
function reason(
	measurement: SizeMeasurement,
	guide: SplitGuide = measurement.guide ?? DEFAULT_GUIDE,
): string {
	const tail = measurement.verdict === SPLIT_VERDICT ? SPLIT_TAIL : SINGLE_TAIL

	return `${counted(measurement)} (${policy_text(guide)}) — ${tail}`
}

interface NoticeBar extends DeclaredSize {
	text: string
}

// The declared size grown by its axis's measured ratio, each axis capped at the guide: a large
// declaration never lifts the bar past the guide, which the notice held before the declaration counted.
function grown_bar(declared: DeclaredSize, guide: SplitGuide): NoticeBar {
	const grown_files = declared.files * declared_growth.factor(guide.growth, 'files')
	const grown_lines = declared.lines * declared_growth.factor(guide.growth, 'lines')
	const files = Math.min(grown_files, guide.files)
	const lines = Math.min(grown_lines, guide.lines)
	const capped = files < grown_files || lines < grown_lines ? ', capped at the guide' : ''
	const declaration = `declared ${String(declared.files)} files / ${String(declared.lines)} lines`

	return {
		files,
		lines,
		text: `${declaration}; ${declared_growth.text(guide.growth)}${capped} = ${String(files)} files / ${String(lines)} lines`,
	}
}

function is_sized(declared: DeclaredSize | undefined): declared is DeclaredSize {
	return declared !== undefined && declared.files > 0 && declared.lines > 0
}

// The bar the notice fires past (joshuafolkken/kit#6206): the Issue's declared size grown, as
// `lane:plan` grows it, so a lane that outgrows its own declaration is told so even under the guide.
// No declaration, one with a zero axis, or one whose grown size reaches the guide is the guide.
function notice_bar(declared: DeclaredSize | undefined, guide: SplitGuide): NoticeBar {
	const guide_bar = { files: guide.files, lines: guide.lines, text: guide_text(guide) }

	if (!is_sized(declared)) return guide_bar
	const bar = grown_bar(declared, guide)

	return bar.files === guide.files && bar.lines === guide.lines ? guide_bar : bar
}

// The `split-assessment.md` headings the notice and a filing refusal point at; the document-rule test
// pins the document to both.
const NOTICE_SECTION = 'Over the guide before the gate'
const QUESTION_SECTION = 'The question'
// The filing's reason line (`size_estimate`); it does not answer a later split notice.
const REASON_PREFIX = issue_body_keys.prefix('no_split_reason')
const NOTICE_ACTION = `go on to the end; a started Issue is never split, and the merge records the overrun as a pre-split miss — split-assessment.md → "${NOTICE_SECTION}"`

// The notice for a diff past `notice_bar` on either axis — strictly greater than, as the guide is — and
// a diff at or under it gives none. A merge past it is recorded as a pre-split miss
// (`lane-size-record.ts`, joshuafolkken/kit#7183); size alone never stops the run (joshuafolkken/kit#6602).
function notice(
	measurement: SizeMeasurement,
	declared?: DeclaredSize,
	guide: SplitGuide = measurement.guide ?? DEFAULT_GUIDE,
): string | undefined {
	const bar = notice_bar(declared, guide)

	if (measurement.files <= bar.files && measurement.lines <= bar.lines) return undefined

	return `split notice: ${counted(measurement)} (${bar.text}; ${policy_text(guide)}) — over the bar, a warning, not a stop: ${NOTICE_ACTION}`
}

const split_assess = {
	DECLARED_GROWTH_FACTOR,
	FILE_CAP,
	FILE_GUIDE,
	LINE_CAP,
	LINE_GUIDE,
	NOTICE_SECTION,
	QUESTION_SECTION,
	REASON_PREFIX,
	SPLIT_VERDICT,
	SINGLE_VERDICT,
	assess,
	guide_for,
	is_deliverable,
	is_over_cap,
	notice,
	measure,
	parse_numstat,
	policy_text,
	reason,
	units_of,
	verdict_for,
}

export type { DeclaredSize, FileChange, SizeMeasurement, SplitGuide, SplitVerdict }
export { split_assess }
