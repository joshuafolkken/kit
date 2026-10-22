import { markdown_section } from '#scripts/issue/markdown-section'
import { report_format_reference } from '#scripts/report/report-format-reference'
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

const DISPOSITION_HEADING = '## 消えたテストの処置'
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

function unique(titles: ReadonlyArray<string>): ReadonlyArray<string> {
	return [...new Set(titles)]
}

function leaf_counts(titles: ReadonlyArray<string>): Map<string, number> {
	const counts = new Map<string, number>()

	for (const title of titles) {
		const leaf = test_titles.leaf_of(title)

		counts.set(leaf, (counts.get(leaf) ?? 0) + 1)
	}

	return counts
}

// Spends one arrived name with the same title, so each arrival accounts for one departure only.
function is_moved(arrived: Map<string, number>, title: string): boolean {
	const leaf = test_titles.leaf_of(title)
	const left = arrived.get(leaf) ?? 0

	if (left === 0) return false
	arrived.set(leaf, left - 1)

	return true
}

function removed(base: ReadonlyArray<string>, head: ReadonlyArray<string>): ReadonlyArray<string> {
	const base_names = new Set(base)
	const head_names = new Set(head)
	const arrived = leaf_counts(unique(head).filter((title) => !base_names.has(title)))

	return unique(base)
		.filter((title) => !head_names.has(title))
		.filter((title) => !is_moved(arrived, title))
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

function pending_rows(titles: ReadonlyArray<string>): ReadonlyArray<string> {
	return titles.map((title) => `- \`${title}\` ${PENDING_SUFFIX}`)
}

// Nothing when the change removed no test, so an ordinary brief is not one line longer.
function brief_block(removed_titles: ReadonlyArray<string>): ReadonlyArray<string> {
	if (removed_titles.length === 0) return []

	return [
		'',
		`${BRIEF_HEADING} — these tests existed at the base and are gone from the change. For each, find the test that guards its behavior now, or the Issue that retired the behavior; a removed test with neither is a finding (missing test). The pull request body must dispose of each ${ROW_FORMAT}, or \`josh followup\` refuses the merge:`,
		...pending_rows(removed_titles),
	]
}

function refusal_message(titles: ReadonlyArray<string>): string {
	return [
		`Merge refused: this change removes ${String(titles.length)} test(s) the pull request body does not account for.`,
		`Put these rows into the body's ${DISPOSITION_HEADING} section, replacing each ending with the test that replaced it or the Issue that retired its behavior:`,
		DISPOSITION_HEADING,
		'',
		...pending_rows(titles),
		`Write ${ROW_FORMAT} — format: ${report_format_reference.pointer(report_format_reference.REMOVED_TESTS_HEADING)}`,
		'Write it into the `--body-file` before `josh ship`, or update an open PR with `gh api -X PATCH repos/{owner}/{repo}/pulls/<N> -F body=@<path>`, then re-run.',
	].join('\n')
}

const removed_tests = {
	brief_block,
	DISPOSITION_HEADING,
	refusal_message,
	removed,
	ROW_FORMAT,
	undisposed,
}

export { removed_tests }
