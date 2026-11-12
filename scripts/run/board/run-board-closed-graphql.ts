import { git_gh_issue_alias_graphql } from '#scripts/gh/git-gh-issue-alias-graphql'
import { PAGE } from '#scripts/gh/git-gh-issue-graphql'
import { issue_merged } from '#scripts/issue/issue-merged'
import { z } from 'zod'

// The run's closed children in one GraphQL query per hundred (joshuafolkken/kit#6791). REST reads each
// child twice — the issue and its timeline — and the board asks again every two minutes about a parked
// or human child, so a run's worth of children spent the core budget on every interval.
//
// Each answer is mapped into what the REST reads produce — the `gh issue view --json` spelling of the
// issue and the timeline events as REST serves them, read by `issue_merged.page_rows` — so the
// answer is the one the REST path would give. A number missing from the answer is read through REST.

const TIMELINE_TYPES = [
	'CLOSED_EVENT',
	'REOPENED_EVENT',
	'CROSS_REFERENCED_EVENT',
	'LABELED_EVENT',
	'UNLABELED_EVENT',
].join(', ')

const CLOSED_FIELDS = `title state stateReason closedAt
	labels(${PAGE}) { nodes { name } }
	timelineItems(${PAGE}, itemTypes: [${TIMELINE_TYPES}]) {
		pageInfo { hasNextPage }
		nodes {
			type: __typename
			... on ClosedEvent { stateReason }
			... on LabeledEvent { label { name } }
			... on UnlabeledEvent { label { name } }
			... on CrossReferencedEvent { source { ... on PullRequest { mergedAt } } }
		}
	}`

// The REST timeline event name of each GraphQL event type the query asks for.
const REST_EVENTS: Readonly<Record<string, string>> = {
	ClosedEvent: 'closed',
	ReopenedEvent: 'reopened',
	CrossReferencedEvent: 'cross-referenced',
	LabeledEvent: 'labeled',
	UnlabeledEvent: 'unlabeled',
}

const label_schema = z.object({ name: z.string() })
const page_info_schema = z.object({ hasNextPage: z.boolean() })

const event_node_schema = z.object({
	type: z.string(),
	stateReason: z.string().nullish(),
	label: label_schema.nullish(),
	source: z.object({ mergedAt: z.string().nullish() }).nullish(),
})

const timeline_schema = z.object({
	pageInfo: page_info_schema,
	nodes: z.array(event_node_schema),
})

const closed_fields_schema = z.object({
	title: z.string(),
	state: z.string(),
	stateReason: z.string().nullish(),
	closedAt: z.string().nullish(),
	labels: z.object({ nodes: z.array(label_schema) }),
	timelineItems: timeline_schema,
})

type ClosedFields = z.infer<typeof closed_fields_schema>
type EventNode = z.infer<typeof event_node_schema>

// One child as the REST reads give it: the issue in `gh issue view --json` spelling, and whether a
// merge closed it — `undefined` when the timeline ran past one page, which REST reads whole.
interface ClosedSource {
	json: string
	is_merged: boolean | undefined
}

// GraphQL spells a reason as an enum (`NOT_PLANNED`); REST and `gh` spell it in lower case.
// A field GraphQL answers `null` is left out, as both REST schemas read a missing field and `null` alike.
function reason_of(reason: string | null | undefined): string | undefined {
	return reason?.toLowerCase()
}

function to_rest_event(node: EventNode): Record<string, unknown> {
	return {
		event: REST_EVENTS[node.type] ?? '',
		state_reason: reason_of(node.stateReason),
		label: node.label ?? undefined,
		source: { issue: { pull_request: { merged_at: node.source?.mergedAt ?? undefined } } },
	}
}

function is_merged_of(issue: ClosedFields): boolean | undefined {
	if (issue.timelineItems.pageInfo.hasNextPage) return undefined

	const events = issue.timelineItems.nodes.map((node) => to_rest_event(node))
	const rows = issue_merged.page_rows(JSON.stringify(events))

	return rows === undefined ? undefined : issue_merged.is_merged_close(rows)
}

function to_source(issue: ClosedFields): ClosedSource {
	const view = {
		title: issue.title,
		state: issue.state,
		stateReason: reason_of(issue.stateReason),
		closedAt: issue.closedAt ?? undefined,
		labels: issue.labels.nodes,
	}

	return { json: JSON.stringify(view), is_merged: is_merged_of(issue) }
}

async function read_sources(
	issues: ReadonlyArray<number>,
): Promise<ReadonlyMap<number, ClosedSource>> {
	const read = await git_gh_issue_alias_graphql.read_aliased(
		issues,
		CLOSED_FIELDS,
		closed_fields_schema,
	)

	return new Map([...read.answers].map(([issue, fields]) => [issue, to_source(fields)]))
}

const run_board_closed_graphql = { read_sources }

export type { ClosedSource }
export { run_board_closed_graphql }
