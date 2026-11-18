import { markdown_section } from '#scripts/issue/markdown-section'
import { report_format_reference } from '#scripts/report/report-format-reference'
import type { Rename } from './renamed-tests'
import { tally } from './tally'
import { test_titles } from './test-titles'

// A test is the record of a behavior, and a change that deletes one with no word of what replaced it
// loses that behavior silently: the gate stays green and the review reads only what is there
// (joshuafolkken/kit#4287, after #4171 dropped `lane_thresholds()` with the tests that guarded it).
// **This is the seam where a deleted test has to be accounted for**: every test the base had and the
// change no longer has is listed in the review brief, and the merge is refused until the pull request
// body names, for each, the test that replaced it or the Issue that retired its behavior.
//
// **A test that moved is not deleted.** Tests are compared by full name across every changed test
// file, so one moved to another file keeps its name. One moved under another `describe` keeps its own
// title, so a gone name is matched against an arrived name with the same title, one for one — a common
// title such as "returns undefined" deleted under one block is still listed when another block keeps
// its own copy.
//
// **A renamed test is removed, with its replacement already known** (`renamed_tests`,
// joshuafolkken/kit#7883): its row is written as replaced by the new title, so neither the run nor the
// reviewer searches for it, and a body without that row is still refused.

const DISPOSITION_HEADING = '## 消えたテストの処置'
// The heading as a line of its own, never the mention of it inside a format hint.
const HEADING_LINE = new RegExp(String.raw`^${DISPOSITION_HEADING}[ \t]*$`, 'mu')
const REPLACED = '置き換え'
const RETIRED = '廃止'
const PENDING_SUFFIX = '— 未記入'
const BRIEF_HEADING = 'Removed tests'
// The title runs to the first backtick that a disposition follows, so a title holding backticks of its
// own — `it('reads the \`.each\` table')` — can still be disposed.
const ROW_PATTERN = new RegExp(
	String.raw`^[-*]\s+\x60(?<title>.+?)\x60\s+—\s+(?<kind>${REPLACED}|${RETIRED}):\s*(?<rest>\S.*)$`,
	'u',
)
// A retirement names the Issue that decided it first — an Issue or a plan comment on one — then why.
const RETIREMENT_PATTERN = /^(?:[\w.-]+\/[\w.-]+)?#\d+\s+\S/u
const ROW_FORMAT = `under ${DISPOSITION_HEADING}, one line per removed test: \`- \`<test>\` — ${REPLACED}: <the test that guards the behavior now>\` or \`- \`<test>\` — ${RETIRED}: #<Issue that retired the behavior> <reason>\``

// The removed titles, and those of them renamed with the title each now has.
interface Removal {
	removed: ReadonlyArray<string>
	renamed: ReadonlyArray<Rename>
}

const NONE: Removal = { removed: [], renamed: [] }

function unique(titles: ReadonlyArray<string>): ReadonlyArray<string> {
	return [...new Set(titles)]
}

// Spends one arrived name with the same title, so each arrival accounts for one departure only.
function removed(base: ReadonlyArray<string>, head: ReadonlyArray<string>): ReadonlyArray<string> {
	const base_names = new Set(base)
	const head_names = new Set(head)
	const arrivals = unique(head).filter((title) => !base_names.has(title))
	const arrived = tally.of(arrivals.map((title) => test_titles.leaf_of(title)))

	return unique(base)
		.filter((title) => !head_names.has(title))
		.filter((title) => !tally.take(arrived, test_titles.leaf_of(title)))
}

// A retirement with no Issue is no row at all, so its test reads as undisposed.
function is_cited(groups: Readonly<Record<string, string>>): boolean {
	return groups['kind'] === REPLACED || RETIREMENT_PATTERN.test(groups['rest'] ?? '')
}

function disposed_title(line: string): string | undefined {
	const groups = ROW_PATTERN.exec(line.trim())?.groups

	if (groups === undefined || !is_cited(groups)) return undefined

	return groups['title']
}

function undisposed(removed_titles: ReadonlyArray<string>, pr_body = ''): ReadonlyArray<string> {
	const disposed = new Set(
		markdown_section
			.section_lines(pr_body, DISPOSITION_HEADING)
			.map((line) => disposed_title(line)),
	)

	return removed_titles.filter((title) => !disposed.has(title))
}

function row_of(title: string, renamed: ReadonlyArray<Rename>): string {
	const rename = renamed.find((candidate) => candidate.from === title)

	if (rename === undefined) return `- \`${title}\` ${PENDING_SUFFIX}`

	return `- \`${title}\` — ${REPLACED}: \`${rename.to}\``
}

function pending_rows(
	titles: ReadonlyArray<string>,
	renamed: ReadonlyArray<Rename> = [],
): ReadonlyArray<string> {
	return titles.map((title) => row_of(title, renamed))
}

function has_row(lines: ReadonlyArray<string>, title: string): boolean {
	return lines.some((line) => line.trim().startsWith(`- \`${title}\` `))
}

// The pending rows a body still lacks, put under its disposition heading — added at the end when the
// body has none — so a run fills them in before `josh ship` rather than meeting them at its preflight
// (joshuafolkken/kit#4563). A title with any row already, pending or filled, is left as it is; a
// renamed title's row is written filled.
function with_pending_rows(
	body: string,
	titles: ReadonlyArray<string>,
	renamed: ReadonlyArray<Rename> = [],
): string {
	const lines = markdown_section.section_lines(body, DISPOSITION_HEADING)
	const missing = titles.filter((title) => !has_row(lines, title))
	const rows = pending_rows(missing, renamed).join('\n')

	if (rows === '') return body
	if (!HEADING_LINE.test(body)) return `${body.trimEnd()}\n\n${DISPOSITION_HEADING}\n\n${rows}\n`

	return body.replace(HEADING_LINE, () => `${DISPOSITION_HEADING}\n\n${rows}`)
}

// Nothing when the change removed no test, so an ordinary brief is not one line longer.
function brief_block(removal: Removal = NONE): ReadonlyArray<string> {
	if (removal.removed.length === 0) return []

	return [
		'',
		`${BRIEF_HEADING} — these tests existed at the base and are gone from the change. For each, find the test that guards its behavior now, or the Issue that retired the behavior; a removed test with neither is a finding (missing test). A row already written as ${REPLACED} is a rename the check matched by its body — not a finding, and its row is checked by \`josh ship\`. The pull request body must dispose of each ${ROW_FORMAT}, or \`josh followup\` refuses the merge:`,
		...pending_rows(removal.removed, removal.renamed),
	]
}

function refusal_message(
	titles: ReadonlyArray<string>,
	renamed: ReadonlyArray<Rename> = [],
): string {
	return [
		`Merge refused: this change removes ${String(titles.length)} test(s) the pull request body does not account for.`,
		`Put these rows into the body's ${DISPOSITION_HEADING} section, replacing each pending ending with the test that replaced it or the Issue that retired its behavior; a row already written as ${REPLACED} is a rename, matched by its body:`,
		DISPOSITION_HEADING,
		'',
		...pending_rows(titles, renamed),
		`Write ${ROW_FORMAT} — format: ${report_format_reference.pointer(report_format_reference.REMOVED_TESTS_HEADING)}`,
		'Write it into the `--body-file` before `josh ship`, or update an open PR with `gh api -X PATCH repos/{owner}/{repo}/pulls/<N> -F body=@<path>`, then re-run.',
	].join('\n')
}

const removed_tests = {
	brief_block,
	DISPOSITION_HEADING,
	NONE,
	refusal_message,
	removed,
	ROW_FORMAT,
	undisposed,
	with_pending_rows,
}

export type { Removal }
export { removed_tests }
