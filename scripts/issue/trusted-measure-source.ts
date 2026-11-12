import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { z } from 'zod'

// Read the executable body and its provenance in one snapshot. REST supplies only the node ID.
const QUERY =
	'query($id: ID!) { node(id: $id) { ... on Issue { body authorAssociation author { login } editor { login } lastEditedAt } } }'
const actor_schema = z.object({ login: z.string().min(1) })
const source_schema = z.object({
	body: z.string(),
	authorAssociation: z.string(),
	author: actor_schema.nullable(),
	editor: actor_schema.nullable(),
	lastEditedAt: z.string().nullable(),
})
const response_schema = z.object({ data: z.object({ node: source_schema }) })
const node_schema = z.object({ node_id: z.string().min(1) })

type MeasureSource = z.infer<typeof source_schema>

async function read(issue: string): Promise<MeasureSource | undefined> {
	try {
		const rest = await git_gh_issue_read.issue_view_json(issue, 'node_id')
		const node = parse_json_object_or_undefined(rest ?? '', node_schema)

		if (node === undefined) return undefined

		const json = await git_gh_exec.exec_gh_api({
			path: 'graphql',
			body: JSON.stringify({ query: QUERY, variables: { id: node.node_id } }),
		})

		return parse_json_object_or_undefined(json, response_schema)?.data.node
	} catch {
		return undefined
	}
}

const trusted_measure_source = { read }

export type { MeasureSource }
export { trusted_measure_source }
