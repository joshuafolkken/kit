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

type RollupItemData = z.infer<typeof rollup_item_schema>

export {
	package_name_schema,
	rollup_item_schema,
	pr_raw_schema,
	pull_comment_schema,
	ai_review_pull_comment_schema,
	pr_info_schema,
}
export type { RollupItemData }
