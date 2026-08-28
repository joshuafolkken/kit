import { z } from 'zod'

const package_name_schema = z.object({ name: z.string().min(1) })

const rollup_item_schema = z.looseObject({
	// eslint-disable-next-line @typescript-eslint/naming-convention -- GraphQL field name from GitHub API
	__typename: z.string().optional(),
	state: z.string().optional(),
	status: z.string().optional(),
	conclusion: z.string().optional(),
	name: z.string().optional(),
	context: z.string().optional(),
})

const pr_raw_schema = z.object({
	statusCheckRollup: z.array(rollup_item_schema).optional(),
	mergeStateStatus: z.string().optional(),
	reviewDecision: z.string().optional(),
})

const pull_comment_schema = z.object({
	body: z.string().optional(),
	html_url: z.string().optional(),
	user: z.object({ login: z.string().optional() }).optional(),
})

const ai_review_pull_comment_schema = z.object({
	body: z.string().optional(),
	url: z.string().optional(),
	author: z.object({ login: z.string().optional() }).optional(),
})

const pr_info_schema = z.object({
	mergeable: z.union([z.boolean(), z.string()]).nullable().optional(),
	mergeStateStatus: z.string().nullable().optional(),
	state: z.string().optional(),
})

const epic_issue_schema = z.object({
	number: z.number(),
	body: z.string().optional(),
})

// One blocker as `gh` reports it inside the `blockedBy` connection. `state` comes back with the
// number, so telling a resolved blocker from a standing one costs no extra request
// (joshuafolkken/kit#996).
// `number` is **required**. Relaxing it looks harmless and is not: `epic_issue.blockers_of` maps the
// nodes to their numbers, so an optional one turns a `blockedBy` shape change from a failed parse —
// which marks the child unreadable — into an empty blocker list, and `epic:next` then hands a
// dependent to an unattended run before its prerequisite. Fail-safe is the direction that matters
// here (joshuafolkken/kit#1005).
const blocking_issue_schema = z.object({
	number: z.number(),
	state: z.string().optional(),
})

// `gh` answers a GraphQL connection — `{ nodes, totalCount }` — not a bare array. Measured against a
// real issue rather than assumed (joshuafolkken/kit#860).
//
// **One definition, every reader.** The same connection was written out three times — twice here and
// once in `scripts/epic/epic-issue.ts` — each naming only the fields its own caller happened to want,
// so a shape change had three places to reach and one of them would not be noticed. That is the
// duplication joshuafolkken/kit#862 removed from the epic commands, reintroduced by the readers that
// came after (joshuafolkken/kit#1005).
//
// `nodes` is a page — `blockedBy(first:50)` — while `totalCount` is exact, so a reader that compares
// them can tell a complete page from a truncated one. **Only the `auto-ok` pickup does**; the epic
// readers judge from the page they were given, so an epic child declaring more than fifty blockers
// is read from the first fifty. Carried here so the field is available, not because every reader
// consults it (joshuafolkken/kit#1005).
const blocked_by_schema = z
	.object({
		nodes: z.array(blocking_issue_schema).default([]),
		totalCount: z.number().optional(),
	})
	.optional()

const epic_child_schema = z.object({
	state: z.string().optional(),
	blockedBy: blocked_by_schema,
})

// `gh issue view --json number,labels,body` for the epic check. Labels come back as objects, so the
// name is picked out here rather than at every call site.
const issue_label_schema = z.object({ name: z.string() })

const epic_subject_schema = z.object({
	number: z.number(),
	labels: z.array(issue_label_schema).optional(),
	body: z.string().optional(),
})

// `gh issue list --json number,title,labels,createdAt,blockedBy` for the next-issues display
// printed when a workflow completes (#821) and for the `auto-ok` pickup (joshuafolkken/kit#906).
// `blockedBy` is optional so a listing taken before the field was requested still parses.
const open_issue_schema = z.object({
	number: z.number(),
	title: z.string(),
	labels: z.array(issue_label_schema).optional(),
	createdAt: z.string(),
	blockedBy: blocked_by_schema,
})

type RollupItemData = z.infer<typeof rollup_item_schema>
type EpicChildData = z.infer<typeof epic_child_schema>
type OpenIssueData = z.infer<typeof open_issue_schema>

export {
	package_name_schema,
	rollup_item_schema,
	pr_raw_schema,
	pull_comment_schema,
	ai_review_pull_comment_schema,
	pr_info_schema,
	epic_issue_schema,
	epic_child_schema,
	epic_subject_schema,
	open_issue_schema,
	blocking_issue_schema,
	blocked_by_schema,
}
export type { RollupItemData, EpicChildData, OpenIssueData }
