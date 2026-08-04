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

const epic_child_schema = z.object({
	state: z.string().optional(),
	blockedBy: z.object({ totalCount: z.number().optional() }).optional(),
})

// `gh issue view --json number,labels,body` for the epic check. Labels come back as objects, so the
// name is picked out here rather than at every call site.
const issue_label_schema = z.object({ name: z.string() })

const epic_subject_schema = z.object({
	number: z.number(),
	labels: z.array(issue_label_schema).optional(),
	body: z.string().optional(),
})

type RollupItemData = z.infer<typeof rollup_item_schema>
type EpicChildData = z.infer<typeof epic_child_schema>

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
}
export type { RollupItemData, EpicChildData }
