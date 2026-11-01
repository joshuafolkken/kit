import { git_gh_issue_list, MAX_SCANNED } from '#scripts/gh/git-gh-issue-list'
import { issue_cite } from '#scripts/issue/issue-cite'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// The `open issues` column of `josh lane:stats --sinks` (joshuafolkken/kit#5711): the open Issues whose
// title names a stage, the match a person made by hand with `gh issue list --search` per row.

const NONE = 'none'
// The listing could not be read — told apart from `none`, which would claim no Issue names the stage.
const UNREAD = 'unread'
const SEPARATOR = ', '

const open_issues_schema = z.array(z.object({ number: z.number(), title: z.string() }))

type OpenIssue = z.infer<typeof open_issues_schema>[number]

// The repository's open Issues, read once for the whole table; `undefined` when unreadable.
async function read(): Promise<ReadonlyArray<OpenIssue> | undefined> {
	const outcome = await git_gh_issue_list.issue_list({
		json_fields: 'number,title',
		limit: MAX_SCANNED,
	})

	return outcome.json === undefined
		? undefined
		: json_value.parse_with(outcome.json, open_issues_schema)
}

// The `#N` of each open Issue whose title contains `stage`, case-insensitively.
function cell(stage: string, issues: ReadonlyArray<OpenIssue> | undefined): string {
	if (issues === undefined) return UNREAD

	const needle = stage.toLowerCase()
	const named = issues.filter((issue) => issue.title.toLowerCase().includes(needle))

	return named.length === 0
		? NONE
		: named.map((issue) => issue_cite.plain(issue.number)).join(SEPARATOR)
}

const lane_sinks_issues = { NONE, UNREAD, read, cell }

export { lane_sinks_issues }
export type { OpenIssue }
