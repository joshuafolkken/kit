import { issue_cite } from '#scripts/issue/issue-cite'
import { shell_quote } from '#scripts/lib/shell-quote'

// The follow-up lines of an evidence comment (`FOLLOW_UP_PATTERN`, one title each) — the Issues a
// measurement's result calls for. A lane child files no Issue, so it writes them there and the parent
// files each: the evidence exit prints the parent's filing line (`issue-evidence-exit.ts`), and the
// parent's `run:merge` names the ones no `FILED` event of that child carries
// (`run-merge-follow-up.ts`). Titles compare exact, surrounding whitespace aside.

const FOLLOW_UP_PATTERN = /^[\t ]*(?:[*-][\t ]+)?後続[:：](?<title>.*)$/gmu
const INDENT = '  '

function titles_of(text: string): ReadonlyArray<string> {
	return [...text.matchAll(FOLLOW_UP_PATTERN)]
		.map((match) => (match.groups?.['title'] ?? '').trim())
		.filter((title) => title.length > 0)
}

function filing_line(title: string, issue_number: string): string {
	const quoted = shell_quote.single_quoted(title)

	return `pnpm josh issue:file ${quoted} --found-during ${issue_number} --body-file <body.md>`
}

function unfiled(
	titles: ReadonlyArray<string>,
	filed_titles: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const filed = new Set(filed_titles.map((title) => title.trim()))

	return titles.filter((title) => !filed.has(title))
}

function lines_of(heading: string, titles: ReadonlyArray<string>, issue_number: string): string {
	const rows = titles.map((title) => `${INDENT}${filing_line(title, issue_number)}`)

	return [heading, ...rows].join('\n')
}

// Printed once the evidence is posted: one filing line per follow-up title, or nothing without one.
function print_filing_lines(evidence: string, issue_number: string): void {
	const titles = titles_of(evidence)

	if (titles.length === 0) return

	const cite = issue_cite.plain_for('program', issue_number)

	console.info(lines_of(`Follow-ups ${cite} names — the parent files each:`, titles, issue_number))
}

const issue_measured_follow_up = { filing_line, lines_of, print_filing_lines, titles_of, unfiled }

export { issue_measured_follow_up }
