import { git_gh_issue_list, MAX_SCANNED } from '#scripts/gh/git-gh-issue-list'
import { INTERRUPT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// The `interrupts` column of `josh hook:ledger` (joshuafolkken/kit#6664): the `route:interrupt` Issues,
// open and closed, filed in the period whose body names a rule — the defects a refusal led to.
//
// **An unreadable listing is `undefined`, never an empty one**, so the column prints `unknown` rather
// than claiming no Issue named the rule.

const STATES = ['open', 'closed'] as const

const issues_schema = z.array(z.object({ body: z.string().nullish(), createdAt: z.string() }))

type InterruptIssue = z.infer<typeof issues_schema>[number]

async function read_state(
	state: (typeof STATES)[number],
): Promise<ReadonlyArray<InterruptIssue> | undefined> {
	const outcome = await git_gh_issue_list.issue_list({
		json_fields: 'body,createdAt',
		limit: MAX_SCANNED,
		label: INTERRUPT_ROUTE_LABEL,
		state,
	})

	if (outcome.json === undefined || outcome.is_capped) return undefined

	return json_value.parse_with(outcome.json, issues_schema)
}

// The interrupt Issues filed since `start_ms`, read once for the whole table; `undefined` when either
// listing is unreadable.
async function read(start_ms: number): Promise<ReadonlyArray<InterruptIssue> | undefined> {
	const [open, closed] = await Promise.all(STATES.map(async (state) => await read_state(state)))

	if (open === undefined || closed === undefined) return undefined

	return [...open, ...closed].filter((issue) => Date.parse(issue.createdAt) >= start_ms)
}

// Whether `body` names `rule` the way a refusal is quoted — its `⛔ <rule>:` opening or the rule in
// backticks — so a rule that is a common word (`investigation`) is not counted from plain prose, nor
// one rule from another it opens (`batch` in `⛔ batching:`).
function names_rule(body: string, rule: string): boolean {
	return body.includes(`⛔ ${rule}:`) || body.includes(`\`${rule}\``)
}

// How many of `issues` name `rule` in their body; `undefined` for an unread or capped listing.
function count(
	rule: string,
	issues: ReadonlyArray<InterruptIssue> | undefined,
): number | undefined {
	return issues?.filter((issue) => names_rule(issue.body ?? '', rule)).length
}

const hook_ledger_issues = { count, read }

export { hook_ledger_issues }
export type { InterruptIssue }
