import { lane_stage_budget } from '#scripts/lane/lane-stage-budget'
import { split_assess } from '#scripts/split/split-assess'
import { issue_body_keys, type IssueBodyValue } from './issue-body-keys'

// joshuafolkken/kit#7925: an Issue whose projected minutes exceed the lane's end-to-end target is split
// by default before it starts. It stays one Issue only when its no-split reason opens with one of the
// kinds below — the cases where not splitting is the better deal; a reason with no kind is refused.
// The "kind, separator, reason" judgment is shared with an epic's declared order (`epic-chain-kind.ts`),
// which passes its own kinds.

const { TARGET_MINUTES } = lane_stage_budget
const { REASON_PREFIX, QUESTION_SECTION } = split_assess
const KIND_NAMES = ['cannot_split', 'better_unsplit', 'slower_overall'] as const
const KINDS = KIND_NAMES.flatMap((name) => issue_body_keys.value_variants(name))
const LEADING_SEPARATOR = /^[\s—:：-]+/u

// Whether what follows a kind is a separator and then the reason itself.
function follows_kind(rest: string): boolean {
	const reason = rest.replace(LEADING_SEPARATOR, '')

	return reason !== '' && reason !== rest
}

// The kind among `names` (either column) the reason opens with, followed by a separator and the reason
// itself; `undefined` with no such kind or no reason.
function kind_among(reason: string, names: ReadonlyArray<IssueBodyValue>): string | undefined {
	return names
		.flatMap((name) => issue_body_keys.value_variants(name))
		.find((kind) => reason.startsWith(kind) && follows_kind(reason.slice(kind.length)))
}

function kind_of(reason: string): string | undefined {
	return kind_among(reason, KIND_NAMES)
}

// `names` as the `<kind>` alternatives a refusal lists.
function kind_list(names: ReadonlyArray<IssueBodyValue>): string {
	return names.map((name) => `\`${issue_body_keys.value(name)}\``).join(' / ')
}

// The no-split declaration every size refusal asks for: a kind, then the reason, which passes the
// guide, the cap, the bar and the lane target alike.
function reason_hint(): string {
	return `\`${REASON_PREFIX} <kind> — <理由>\` (<kind>: ${kind_list(KIND_NAMES)})`
}

function refusal(minutes: number): string {
	return `projects ${String(Math.round(minutes))} implement minute(s), over the ${String(TARGET_MINUTES)}-minute lane target — split it by default (\`--route split\` children each within the target); keep it one Issue only by declaring ${reason_hint()}; split-assessment.md → "${QUESTION_SECTION}"`
}

// The refusal for `minutes` over the target without a reason naming its kind; `undefined` within the
// target, with no projection, or with such a reason.
function problem(minutes: number | undefined, reason = ''): string | undefined {
	if (minutes === undefined || minutes <= TARGET_MINUTES) return undefined

	return kind_of(reason) === undefined ? refusal(minutes) : undefined
}

const size_estimate_target = { KINDS, kind_among, kind_list, problem, reason_hint }

export { size_estimate_target }
