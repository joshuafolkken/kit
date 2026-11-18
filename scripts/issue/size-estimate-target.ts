import { lane_stage_budget } from '#scripts/lane/lane-stage-budget'
import { split_assess } from '#scripts/split/split-assess'
import { issue_body_keys } from './issue-body-keys'

// joshuafolkken/kit#7925: an Issue whose projected minutes exceed the lane's end-to-end target is split
// by default before it starts. It stays one Issue only when its no-split reason opens with one of the
// kinds below — the cases where not splitting is the better deal; a reason with no kind is refused.

const { TARGET_MINUTES } = lane_stage_budget
const { REASON_PREFIX, QUESTION_SECTION } = split_assess
const KIND_NAMES = ['cannot_split', 'better_unsplit', 'slower_overall'] as const
const KINDS = KIND_NAMES.flatMap((name) => issue_body_keys.value_variants(name))
const LEADING_SEPARATOR = /^[\s—:：-]+/u

// The kind the reason opens with, followed by the reason itself; `undefined` with no kind or no reason.
function kind_of(reason: string): string | undefined {
	return KINDS.find(
		(kind) =>
			reason.startsWith(kind) && reason.slice(kind.length).replace(LEADING_SEPARATOR, '') !== '',
	)
}

function refusal(minutes: number): string {
	const kinds = KIND_NAMES.map((name) => `\`${issue_body_keys.value(name)}\``).join(' / ')

	return `projects ${String(Math.round(minutes))} implement minute(s), over the ${String(TARGET_MINUTES)}-minute lane target — split it by default (\`--route split\` children each within the target); keep it one Issue only by declaring \`${REASON_PREFIX} <kind> — <reason>\` with <kind> one of ${kinds}; split-assessment.md → "${QUESTION_SECTION}"`
}

// The refusal for `minutes` over the target without a reason naming its kind; `undefined` within the
// target, with no projection, or with such a reason.
function problem(minutes: number | undefined, reason = ''): string | undefined {
	if (minutes === undefined || minutes <= TARGET_MINUTES) return undefined

	return kind_of(reason) === undefined ? refusal(minutes) : undefined
}

const size_estimate_target = { KINDS, problem }

export { size_estimate_target }
