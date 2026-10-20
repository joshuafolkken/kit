import { issue_cite } from '#scripts/issue/issue-cite'
import {
	epic_bundle,
	type BacklogIssue,
	type BundleAction,
	type BundleDecision,
} from './epic-bundle'
import { epic_bundle_evidence } from './epic-bundle-evidence'
import { epic_bundle_gaps } from './epic-bundle-gaps'
import { format_dependency_links } from './epic-reference'

// How `josh epic:bundle` words its verdict. Split out of `epic-bundle-cli.ts`, which reads the backlog,
// when `--apply` pushed that file past its line ceiling; the wording has no reads of its own.

const ACTION_LINES: Readonly<Record<string, string>> = {
	add_to_epic: 'Add it to the epic that already tracks a related issue (Tier A — do it).',
	create_epic: 'Create an epic for these (Tier A — do it).',
	ask: 'Related issues sit in more than one epic: choose the one you recommend, add it, and record why (Tier A — do it).',
	none: 'Nothing to bundle.',
}

// `Nothing to bundle.` is right when nothing was found, and wrong when an epic already tracks the
// issue — there the answer is actionable: a caller looking for somewhere to put a prerequisite adds
// it to *that* epic rather than creating a second one.
const ALREADY_TRACKED_LINE = 'Already in an epic — add to that one, do not create a second.'

function headline(decision: BundleDecision): string {
	if (decision.action === 'none' && decision.epics.length > 0) return ALREADY_TRACKED_LINE

	return ACTION_LINES[decision.action] ?? ''
}

function format_numbers(numbers: ReadonlyArray<number>): string {
	return numbers.map((issue_number) => issue_cite.plain(issue_number)).join(', ')
}

// The backlog rows of the verdict's candidates — what the printed order and `--apply` both read.
function members_of(
	decision: BundleDecision,
	backlog: ReadonlyArray<BacklogIssue>,
): Array<BacklogIssue> {
	return backlog.filter((issue) => decision.candidates.includes(issue.number))
}

// The order to record alongside the bundle. Bundling without it records the batch and loses the
// reason it is a batch, so the recommendation carries it rather than leaving it to be remembered.
function format_links(links: ReadonlyArray<{ blocker: number; blocked: number }>): string {
	if (links.length === 0) return '  Order: none declared — do not invent one'

	return `  Order: ${format_dependency_links(links)}`
}

function format_order(
	decision: BundleDecision,
	subject: BacklogIssue,
	backlog: ReadonlyArray<BacklogIssue>,
): Array<string> {
	if (decision.action !== 'add_to_epic' && decision.action !== 'create_epic') return []
	const members = members_of(decision, backlog)
	const children = epic_bundle.bundle_children(subject, members)

	// The evidence goes under the order rather than beside the verdict: what it explains is the
	// order, and a reader checking one reads straight on into the other.
	return [
		`  Children: ${format_numbers(children)}`,
		format_links(epic_bundle.bundle_dependency_links(subject, members)),
		...epic_bundle_evidence.format_evidence(subject, members),
	]
}

// The verdicts that put the subject into an epic. Each one asserts that no epic already tracks it —
// `create_epic` asserts as much about the candidates too — and that negative is exactly what a cut
// epic listing cannot establish. `none` is absent on purpose: it either
// names the epic it *found* tracking the subject, which a cut cannot unseat, or reports no candidate
// at all, which says nothing about epics.
const PLACING_ACTIONS: ReadonlySet<BundleAction> = new Set<BundleAction>([
	'add_to_epic',
	'create_epic',
	'ask',
])

// `is_membership_established` is what separates "no epic tracks these" from "their epics were never
// read".
function format_decision(
	decision: BundleDecision,
	subject: BacklogIssue,
	backlog: ReadonlyArray<BacklogIssue>,
	is_membership_established: boolean,
): string {
	if (!is_membership_established && PLACING_ACTIONS.has(decision.action)) {
		return epic_bundle_gaps.unconfirmed_membership(format_numbers(decision.candidates)).join('\n')
	}

	const lines = [headline(decision), `  ${decision.reason}`]

	if (decision.candidates.length > 0) {
		lines.push(`  Related: ${format_numbers(decision.candidates)}`)
	}

	if (decision.epics.length > 1) {
		lines.push(`  Epics involved: ${format_numbers(decision.epics)}`)
	}

	return [...lines, ...format_order(decision, subject, backlog)].join('\n')
}

const epic_bundle_format = {
	ACTION_LINES,
	ALREADY_TRACKED_LINE,
	format_numbers,
	format_order,
	format_decision,
	members_of,
}

export { epic_bundle_format }
