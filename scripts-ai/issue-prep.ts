#!/usr/bin/env tsx
/**
 * Fetch a GitHub issue and report title status + suggested branch name.
 *
 * Usage: tsx scripts-ai/issue-prep.ts <issue-number>
 */
import { fileURLToPath } from 'node:url'
import { git_gh_issue_read, type IssueRead } from '../scripts/git/git-gh-issue-read'
import { git_gh_issue_write } from '../scripts/git/git-gh-issue-write'
import { IN_PROGRESS_LABEL } from '../scripts/git/issue-labels'
import { issue_logic } from '../scripts/issue/issue-logic'

// joshuafolkken/kit#1063: every GitHub call here used to be an `execaSync('gh', ['issue', …])`
// spawn, which goes through GraphQL and is answered 403 in a cloud session — so `josh issue <N>`
// was one of the last places joshuafolkken/kit#1022's REST migration had not reached.
//
// The replacement is asynchronous rather than a synchronous twin of the write layer, which is what
// `josh propagate` needed (joshuafolkken/kit#1042). The two cases differ in how far the synchronous
// shape reaches: there it ran from `open_issue` up through `RunStep`, `run_target` and `run_targets`,
// where a `.map()` over consumers depends on the handler being synchronous to stay sequential. Here
// it reaches exactly one caller — `main`, the module entry, called by nothing else — and this file's
// sibling `prep.ts` already awaits its own `main` at the top level. So awaiting the existing
// `git_gh_issue_read` / `git_gh_issue_write` helpers adds no execution mechanism at all.

const ARGV_INDEX = 2
const IN_PROGRESS_COLOR = '#0075ca'
const IN_PROGRESS_DESCRIPTION = 'Work is actively in progress'
const FAILURE_EXIT_CODE = 1
const TITLE_FIELD = 'title'

function display_language_status(is_cjk: boolean): string {
	return is_cjk ? '⚠ Contains CJK — needs English translation' : '✔ English'
}

function parse_issue_number(): string {
	const argument = process.argv[ARGV_INDEX]

	if (argument === undefined || !/^[1-9]\d*$/u.test(argument)) {
		console.error('Usage: tsx scripts-ai/issue-prep.ts <issue-number>')
		process.exit(FAILURE_EXIT_CODE)
	}

	return argument
}

// Why there was no title, in the answers that are actually different to the person reading them.
// The old spawn printed gh's own stderr, and `issue_get_title` swallows it — so a 403, the very
// failure this change is about, would otherwise arrive as `Failed to fetch` and nothing else.
//
// The `read` branch is deliberately non-committal. It is reached when the issue itself came back
// but the title did not, which is an empty title *or* a first read that failed and a retry that
// did not — and asserting either one would be the misdiagnosis this message exists to remove.
function title_failure_message(issue_number_string: string, kind: IssueRead['kind']): string {
	if (kind === 'missing') return `✖ Issue #${issue_number_string} does not resolve`
	if (kind === 'read') return `✖ Could not read a title for issue #${issue_number_string}`

	return `✖ Could not read issue #${issue_number_string} — the request failed. A rate limit, expired authentication (\`gh auth status\`), or no network.`
}

// `issue_get_title` answers `undefined` for a read that failed *and* for an issue whose title is
// empty, which is the same "there is no title to work from" the old spawn reported by throwing.
// Both end the run here, because everything below prints or labels against that title.
//
// The classified read costs one extra request and is spent only on this path, which is what it
// exists for: it is the difference between a number that resolves to nothing and a request nobody
// could make.
async function fetch_title_for_issue(issue_number_string: string): Promise<string> {
	const title = await git_gh_issue_read.issue_get_title(issue_number_string)
	if (title !== undefined) return title

	const read = await git_gh_issue_read.issue_view_json_classified(issue_number_string, TITLE_FIELD)

	console.error(title_failure_message(issue_number_string, read.kind))

	return process.exit(FAILURE_EXIT_CODE)
}

function display_issue_info(
	issue_number: number,
	issue_number_string: string,
	title: string,
): void {
	const result = issue_logic.prepare(issue_number, title)

	console.info('')
	console.info(`📋 Issue #${issue_number_string}`)
	console.info(`  Title:    ${result.title}`)
	console.info(`  Language: ${display_language_status(result.is_cjk)}`)
	console.info(`  Branch:   ${result.suggested_branch}`)
	console.info('')
}

// `label_ensure` swallows the 422 an existing label answers with, which is the `|| true` the old
// `gh label create` call site spelled out as an empty catch.
async function ensure_in_progress_label(): Promise<void> {
	await git_gh_issue_write.label_ensure({
		name: IN_PROGRESS_LABEL,
		color: IN_PROGRESS_COLOR,
		description: IN_PROGRESS_DESCRIPTION,
	})
}

// The old spawn threw on a refused edit and nothing caught it, so the command ended non-zero with a
// stack trace. The exit code is kept and the stack trace is not: `issue_add_label` answers `false`
// instead of throwing, and a label that was not applied is the one thing this command exists to do.
async function assign_in_progress_label(issue_number_string: string): Promise<void> {
	const is_applied = await git_gh_issue_write.issue_add_label(
		issue_number_string,
		IN_PROGRESS_LABEL,
	)

	if (!is_applied) {
		console.error(`✖ Failed to apply the ${IN_PROGRESS_LABEL} label to #${issue_number_string}`)
		process.exit(FAILURE_EXIT_CODE)
	}

	console.info(`  Label:    ${IN_PROGRESS_LABEL} ✔`)
}

async function main(): Promise<void> {
	const issue_number_string = parse_issue_number()
	const issue_number = Number(issue_number_string)
	const title = await fetch_title_for_issue(issue_number_string)

	display_issue_info(issue_number, issue_number_string, title)
	await ensure_in_progress_label()
	await assign_in_progress_label(issue_number_string)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const issue_prep = {
	display_language_status,
	fetch_title_for_issue,
	ensure_in_progress_label,
	assign_in_progress_label,
}

export { issue_prep }
