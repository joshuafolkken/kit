import {
	DEPTH_0_LABEL,
	DEPTH_1_LABEL,
	DEPTH_2_LABEL,
	depth_label_of,
	EPIC_LABEL,
	has_any_label,
} from '#scripts/git/issue-labels'

// **The share joshuafolkken/kit#1698 set as a target, computed rather than hand-counted**
// (joshuafolkken/kit#1729). Nothing recorded a depth, so the number could only be had by opening
// every open Issue and classifying it by eye — and two such counts a day apart took different
// denominators, which is why they could not be compared.
//
// **The denominator rule is not restated here.**
// `.claude/skills/workflow-commands/observation-filing.md` → "The depth-0 share", is its single source, and a
// paraphrase in this comment would be the clone `CLAUDE.md` prohibits — the same decision
// `scripts/git/issue-labels.ts` records for the depth labels' own descriptions. What follows is the
// implementation of that rule: a filter, three tallies and a percentage, with the only judgement —
// which depth an Issue carrying several counts as — delegated to `depth_label_of`.
const PERCENT_SCALE = 100

const EPIC_LABELS: ReadonlySet<string> = new Set([EPIC_LABEL])

// Only the labels are read, so the summary takes any listing row rather than the full issue schema —
// which is also what lets a test state a case as one object literal instead of a whole fixture.
interface DepthCountable {
	// `| undefined` rather than a plain optional, the same spelling `IssueListRequest.repo` carries and
	// for the same reason: `open_issue_schema.labels` is a zod `.optional()`, which under
	// `exactOptionalPropertyTypes` is `Array<…> | undefined` and will not narrow to a bare optional.
	labels?: ReadonlyArray<{ name: string }> | undefined
}

interface DepthShare {
	denominator: number
	depth_0: number
	depth_1: number
	depth_2: number
	unlabelled: number
	epics_excluded: number
	share_percent: number
}

function is_epic(issue: DepthCountable): boolean {
	return has_any_label(issue.labels, EPIC_LABELS)
}

function count_of(depths: ReadonlyArray<string | undefined>, name: string | undefined): number {
	return depths.filter((depth) => depth === name).length
}

// Zero open Issues is a real state rather than an error, and a share of `0/0` is reported as 0%.
function to_percent(part: number, whole: number): number {
	return whole === 0 ? 0 : Math.round((part / whole) * PERCENT_SCALE)
}

function summarize(issues: ReadonlyArray<DepthCountable>): DepthShare {
	const counted = issues.filter((issue) => !is_epic(issue))
	const depths = counted.map((issue) => depth_label_of(issue.labels))
	const depth_0 = count_of(depths, DEPTH_0_LABEL)

	return {
		denominator: counted.length,
		depth_0,
		depth_1: count_of(depths, DEPTH_1_LABEL),
		depth_2: count_of(depths, DEPTH_2_LABEL),
		unlabelled: count_of(depths, undefined),
		epics_excluded: issues.length - counted.length,
		share_percent: to_percent(depth_0, counted.length),
	}
}

function format_headline(share: DepthShare): string {
	const ratio = `${String(share.depth_0)}/${String(share.denominator)}`

	return `${ratio} = ${String(share.share_percent)}%`
}

// Every number that went into the headline, so a reader can check the denominator against the rule
// above instead of taking the percentage on trust.
function format_breakdown(share: DepthShare): string {
	return [
		`denominator ${String(share.denominator)} open issues`,
		`epics excluded ${String(share.epics_excluded)}`,
		`${DEPTH_0_LABEL} ${String(share.depth_0)}`,
		`${DEPTH_1_LABEL} ${String(share.depth_1)}`,
		`${DEPTH_2_LABEL} ${String(share.depth_2)}`,
		`unlabelled ${String(share.unlabelled)}`,
	].join(' — ')
}

const issue_depth_share = {
	format_breakdown,
	format_headline,
	summarize,
}

export type { DepthCountable, DepthShare }
export { issue_depth_share }
