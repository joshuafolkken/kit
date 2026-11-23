import { repo_party } from '#scripts/discovery/repo-party'
import { defect_rate } from './defect-rate'
import { issue_search, type SearchIssue, type SearchResult } from './issue-search'
import { rework_classification } from './rework-classification'
import { rework_reference_state } from './rework-reference-state'
import { session_cite } from './session-cite'

// `josh issue:rework-candidates --since <days>` — the enhancements closed in the window whose body the
// rework judgement hits, each with the delivered work it cites, for a run to reclassify one by one
// with `issue:kind` (joshuafolkken/kit#8799). Read-only: it changes no label and no body.

const USAGE = 'Usage: pnpm josh issue:rework-candidates --since <days>'
const SINCE_FLAG = '--since'
const UNREADABLE = '✖ could not read the closed enhancements or the states they cite'

interface Candidate {
	issue: SearchIssue
	numbers: ReadonlyArray<number>
}

function days_of(argv: ReadonlyArray<string>): number | undefined {
	const [flag, text, ...rest] = argv
	if (flag !== SINCE_FLAG || rest.length > 0) return undefined
	const days = Number(text)

	return Number.isSafeInteger(days) && days > 0 ? days : undefined
}

function repository(): string | undefined {
	const identity = repo_party.current_repository()

	return identity === undefined ? undefined : `${identity.owner}/${identity.repo}`
}

function line_of({ issue, numbers }: Candidate): string {
	const cited = numbers.map((number) => session_cite.issue(number)).join(', ')

	return `${session_cite.issue(issue.number, issue.title)}  → ${cited}`
}

function candidates_of(
	issues: ReadonlyArray<SearchIssue>,
	delivered: ReadonlySet<number>,
): ReadonlyArray<string> {
	return issues
		.map((issue) => ({ issue, numbers: rework_classification.reworked(issue.body, delivered) }))
		.filter((candidate) => candidate.numbers.length > 0)
		.map((candidate) => line_of(candidate))
}

function header_of(since: string, found: number, result: SearchResult): string {
	const capped = result.is_capped ? ' (the search was capped; older Issues are missing)' : ''

	return `rework candidates closed since ${since}: ${String(found)} of ${String(result.issues.length)} completed enhancement(s)${capped}`
}

async function listing(
	repo: string,
	since: string,
	now_ms: number,
): Promise<ReadonlyArray<string> | undefined> {
	const result = await issue_search.search_complete(
		defect_rate.completed_query(repo, since),
		now_ms,
	)
	if (result === undefined) return undefined
	const cited = result.issues.flatMap((issue) => rework_classification.cited(issue.body))
	const delivered = await rework_reference_state.delivered(cited, repo)
	if (delivered === undefined) return undefined
	const found = candidates_of(result.issues, delivered)

	return [header_of(since, found.length, result), ...found]
}

function printed(lines: ReadonlyArray<string> | undefined): number {
	if (lines === undefined) {
		console.error(UNREADABLE)

		return 1
	}

	console.info(lines.join('\n'))

	return 0
}

async function run(argv: ReadonlyArray<string>, now_ms: number = Date.now()): Promise<number> {
	const days = days_of(argv)
	const repo = repository()

	if (days === undefined || repo === undefined) {
		console.error(USAGE)

		return 1
	}

	return printed(await listing(repo, defect_rate.window_start(now_ms, days), now_ms))
}

const issue_rework_candidates_cli = { run }

export { issue_rework_candidates_cli }
