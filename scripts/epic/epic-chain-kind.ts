import { issue_body_keys } from '#scripts/issue/issue-body-keys'
import { size_estimate_target } from '#scripts/issue/size-estimate-target'
import { split_assess } from '#scripts/split/split-assess'
import { epic_body, type OrderReason } from './epic-body'

// joshuafolkken/kit#8636: a declared order at an epic's creation or promotion opens with its kind —
// the later child cannot be verified in the same pass as the earlier, or it waits on something besides
// its sibling. A chain with neither is a pure serial chain: each child pays the fixed cost again and
// they run one at a time, so the whole finishes later than one Issue would. Such a chain is refused
// with the one-Issue declaration to use instead. `--add` and its positions are not asked.

const KIND_NAMES = ['unverifiable_in_one_pass', 'other_wait'] as const
const { REASON_PREFIX, QUESTION_SECTION } = split_assess

function has_kind(entry: OrderReason): boolean {
	return size_estimate_target.kind_among(entry.reason, KIND_NAMES) !== undefined
}

function refusal_of(entry: OrderReason): string {
	const chain = epic_body.format_chain(entry.chain)
	const expected = `\`--order-reason "${chain}: <kind> — <reason>"\` (<kind>: ${size_estimate_target.kind_list(KIND_NAMES)})`
	const merge = `\`${REASON_PREFIX} ${issue_body_keys.value('slower_overall')} — <理由>\``

	return `The declared order \`${chain}\` names no kind; give ${expected}. A chain with neither kind is a pure serial chain that finishes later than one Issue — keep it one Issue with ${merge} (split-assessment.md → "${QUESTION_SECTION}"). Nothing was written.`
}

// The refusal for the first declared order with no kind; `undefined` when every one names its kind.
function find_refusal(reasons: ReadonlyArray<OrderReason>): string | undefined {
	const missing = reasons.find((entry) => !has_kind(entry))

	return missing === undefined ? undefined : refusal_of(missing)
}

const epic_chain_kind = { find_refusal }

export { epic_chain_kind }
