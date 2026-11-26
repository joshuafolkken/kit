import {
	issue_body_keys,
	type IssueBodyKey,
	type IssueBodyValue,
} from '#scripts/issue/issue-body-keys'
import { size_estimate } from '#scripts/issue/size-estimate'
import { split_assess } from '#scripts/split/split-assess'

// joshuafolkken/kit#8760: the rule `josh.worker.route` applies to an Issue with no `worker:` label —
// whether its body declares work light enough for the weakest profile. A design decision keeps the
// default: a behaviour change or breaking change, a person's judgement, or a size the body does not
// declare within the guide (`size_estimate`'s verdict on the counts, a no-split reason or not).
interface Route {
	is_light: boolean
	reason: string
}

// The declarations whose value names design work, and the values that do.
const DESIGN_KEYS: ReadonlyArray<IssueBodyKey> = ['kind', 'purpose', 'compatibility']
const DESIGN_VALUES: ReadonlyArray<IssueBodyValue> = ['behavior_change', 'breaking']

function declared_value(body: string, key: IssueBodyKey): string {
	const values = issue_body_keys
		.prefix_variants(key)
		.map((prefix) => size_estimate.declared(body, prefix))

	return values.find((value) => value !== undefined) ?? ''
}

function names_value(text: string, value: IssueBodyValue): boolean {
	return issue_body_keys.value_variants(value).some((variant) => text.startsWith(variant))
}

function design_declaration(body: string): string | undefined {
	const values = DESIGN_KEYS.map((key) => declared_value(body, key))

	return values.find((text) => DESIGN_VALUES.some((value) => names_value(text, value)))
}

function heavy_reason(body: string): string | undefined {
	const design = design_declaration(body)
	if (design !== undefined) return `declares ${design}`
	if (names_value(declared_value(body, 'judgement'), 'needed')) return 'needs a person'
	const estimate = size_estimate.declared_size(body)
	if (estimate === undefined) return 'declares no size estimate'

	return estimate.verdict === split_assess.SPLIT_VERDICT ? 'is over the size guide' : undefined
}

// The route for an Issue body: light only when nothing in it calls for the default profile.
function route(body: string): Route {
	const reason = heavy_reason(body)

	return reason === undefined
		? { is_light: true, reason: 'small and declares no design change' }
		: { is_light: false, reason }
}

const agent_worker_route = { route }

export type { Route }
export { agent_worker_route }
