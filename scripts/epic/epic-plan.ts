import { epic_issue } from './epic-issue'

// The machine-readable snapshot `epic:plan` puts in front of the batch decision.
//
// Every decision an epic needs is answerable before the implementation starts; today they arrive
// scattered through the run, which is what forces a person to stay at the machine. Reading all of
// the children at once is what makes one batch possible (joshuafolkken/kit#862).

// One child, as the plan reports it.
interface PlanChild {
	number: number
	title: string
	body: string
	state: string
	labels: ReadonlyArray<string>
	blocked_by: ReadonlyArray<number>
}

interface EpicPlan {
	epic: number
	children: ReadonlyArray<PlanChild>
}

// A child from one `gh issue view --json …` response, or nothing when the response is not an issue
// at all. Missing optional fields become empty values rather than absent keys, so a consumer reads
// one shape whatever `gh` answered.
function to_plan_child(raw: string | undefined): PlanChild | undefined {
	const parsed = epic_issue.parse_epic_issue(raw)
	if (parsed === undefined) return undefined

	return {
		number: parsed.number,
		title: parsed.title,
		body: parsed.body,
		state: parsed.state,
		labels: epic_issue.label_names(parsed),
		blocked_by: epic_issue.blockers_of(parsed),
	}
}

// The plan for one epic. An epic with no children is an empty result, not a failure: an epic whose
// children are all closed is a finished epic, and reporting that as an error would make the command
// unusable at exactly the point a run asks whether anything is left.
function build_plan(epic: number, children: ReadonlyArray<PlanChild>): EpicPlan {
	return { epic, children: children.toSorted((left, right) => left.number - right.number) }
}

// Pretty-printed, because a person reads this as often as a program does.
function format_plan(plan: EpicPlan): string {
	return JSON.stringify(plan, undefined, '\t')
}

const epic_plan = {
	UNKNOWN_STATE: epic_issue.UNKNOWN_STATE,
	to_plan_child,
	build_plan,
	format_plan,
}

export type { EpicPlan, PlanChild }
export { epic_plan }
