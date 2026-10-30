import {
	ALREADY_DONE_LABEL,
	AUTO_OK_LABEL,
	has_label_name,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	PRIORITY_HIGH_LABEL,
	RUN_LANE_LABEL,
	RUN_STALLED_LABEL,
} from '#scripts/issue/issue-labels'
import type { CarryAddition } from '#scripts/run/carry/run-carry-added'

// `josh run:add` — put an issue into a live `backlogrun`. A pool run picks an issue up only once it
// carries `auto-ok` and `run:lane`, and takes a `priority:high` one first; a `--only` run reads its
// named list off the carry record. **A running child is never interrupted**: an added issue takes the
// next lane that frees, ahead of the rest unless `--no-priority` puts it at the end.
//
// What is decided here is per issue and pure over its ports, so a suite drives every outcome without
// `gh`; `run-add-cli.ts` finds the run, wires the ports and writes the record.

interface IssueView {
	is_open: boolean
	labels?: ReadonlyArray<string>
	// The open issues this one is blocked by. A blocked issue is accepted and said to be waiting: the
	// run reaches it once its blockers close, as a named issue's blockers are honored.
	blockers: ReadonlyArray<number>
}

interface AddPorts {
	read_issue: (issue: number) => Promise<IssueView | undefined>
	apply_label: (issue: number, label: string) => Promise<boolean>
	clear_label: (issue: number, label: string) => Promise<boolean>
}

interface AddContext {
	is_retry: boolean
	done: ReadonlyArray<number>
	active: ReadonlySet<string>
	settled?: ReadonlySet<number>
}

const DEFAULT_CONTEXT: AddContext = { is_retry: false, done: [], active: new Set() }
const PROTECTED_LABELS = [
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	ALREADY_DONE_LABEL,
	IN_PROGRESS_LABEL,
]

type AddOutcome =
	| { kind: 'queued'; issue: number; blockers: ReadonlyArray<number> }
	| { kind: 'closed'; issue: number }
	| { kind: 'unreadable'; issue: number }
	| { kind: 'unlabeled'; issue: number; label: string }
	| { kind: 'refused'; issue: number; reason: string }

const ISSUE_PREFIX = '#'
const BLOCKER_SEPARATOR = ', '

function labels_for(is_priority: boolean): ReadonlyArray<string> {
	const opted_in = [AUTO_OK_LABEL, RUN_LANE_LABEL]

	return is_priority ? [...opted_in, PRIORITY_HIGH_LABEL] : opted_in
}

// The first label that would not apply, or `undefined` once every one landed. Sequential, so a
// refused write stops the rest rather than leaving a half-labelled issue the pool reads differently.
async function first_unapplied(
	issue: number,
	labels: ReadonlyArray<string>,
	ports: AddPorts,
): Promise<string | undefined> {
	const [label, ...rest] = labels

	if (label === undefined) return undefined

	if (!(await ports.apply_label(issue, label))) return label

	return await first_unapplied(issue, rest, ports)
}

function retry_required(
	issue: number,
	labels: ReadonlyArray<string>,
	context: AddContext,
): boolean {
	return (
		!context.is_retry && (context.done.includes(issue) || has_label_name(labels, RUN_STALLED_LABEL))
	)
}

function terminal_refusal(issue: number, context: AddContext): string | undefined {
	return context.settled?.has(issue) ? 'not a mechanical stop' : undefined
}

function refusal(issue: number, view: IssueView, context: AddContext): string | undefined {
	const labels = view.labels ?? []
	const protected_label = PROTECTED_LABELS.find((label) => has_label_name(labels, label))

	if (protected_label !== undefined) return protected_label
	if (context.active.has(String(issue))) return 'active lane'
	if (retry_required(issue, labels, context)) return 'use --retry'

	return terminal_refusal(issue, context)
}

async function label_one(
	issue: number,
	is_priority: boolean,
	ports: AddPorts,
	context: AddContext,
): Promise<AddOutcome> {
	const label = await first_unapplied(issue, labels_for(is_priority), ports)

	if (label !== undefined) return { kind: 'unlabeled', issue, label }

	if (context.is_retry && !(await ports.clear_label(issue, RUN_STALLED_LABEL))) {
		return { kind: 'refused', issue, reason: 'could not clear run:stalled' }
	}

	return { kind: 'queued', issue, blockers: [] }
}

async function add_one(
	issue: number,
	is_priority: boolean,
	ports: AddPorts,
	context: AddContext,
): Promise<AddOutcome> {
	const view = await ports.read_issue(issue)

	if (view === undefined) return { kind: 'unreadable', issue }
	if (!view.is_open) return { kind: 'closed', issue }

	const reason = refusal(issue, view, context)

	if (reason !== undefined) return { kind: 'refused', issue, reason }

	const outcome = await label_one(issue, is_priority, ports, context)

	return outcome.kind === 'queued' ? { ...outcome, blockers: view.blockers } : outcome
}

// In the order typed, one at a time: the order is the priority, and the reads are a handful of `gh`
// calls rather than a pool's worth.
async function add_all(
	issues: ReadonlyArray<number>,
	is_priority: boolean,
	ports: AddPorts,
	context: AddContext = DEFAULT_CONTEXT,
): Promise<ReadonlyArray<AddOutcome>> {
	const [issue, ...rest] = issues

	if (issue === undefined) return []

	const outcome = await add_one(issue, is_priority, ports, context)

	return [outcome, ...(await add_all(rest, is_priority, ports, context))]
}

function additions_of(
	outcomes: ReadonlyArray<AddOutcome>,
	is_priority: boolean,
): ReadonlyArray<CarryAddition> {
	return outcomes
		.filter((outcome) => outcome.kind === 'queued')
		.map((outcome) => ({ issue: outcome.issue, is_priority }))
}

function blockers_text(blockers: ReadonlyArray<number>): string {
	return blockers.map((blocker) => `${ISSUE_PREFIX}${String(blocker)}`).join(BLOCKER_SEPARATOR)
}

function queued_line(issue: string, blockers: ReadonlyArray<number>, is_priority: boolean): string {
	if (blockers.length > 0) return `queued ${issue} · waiting: blocked by ${blockers_text(blockers)}`

	return `queued ${issue} · ${is_priority ? 'next free lane' : 'end of the queue'}`
}

// One line per issue, the outcome first, so a reader scanning the output sees which ones went in.
function describe(outcome: AddOutcome, is_priority: boolean): string {
	const issue = `${ISSUE_PREFIX}${String(outcome.issue)}`

	if (outcome.kind === 'queued') return queued_line(issue, outcome.blockers, is_priority)

	if (outcome.kind === 'closed') return `refused ${issue} · closed`

	if (outcome.kind === 'unreadable') return `refused ${issue} · could not be read`
	if (outcome.kind === 'refused') return `refused ${issue} · ${outcome.reason}`

	return `refused ${issue} · could not apply \`${outcome.label}\``
}

function is_all_queued(outcomes: ReadonlyArray<AddOutcome>): boolean {
	return outcomes.every((outcome) => outcome.kind === 'queued')
}

const run_add = { add_all, additions_of, describe, is_all_queued, labels_for }

export type { AddContext, AddOutcome, AddPorts, IssueView }
export { run_add }
