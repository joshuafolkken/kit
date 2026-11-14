import {
	ALREADY_DONE_LABEL,
	AUTO_OK_LABEL,
	has_label_name,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	PRIORITY_HIGH_LABEL,
	RUN_LANE_LABEL,
	RUN_STALLED_LABEL,
} from '#scripts/issue/issue-labels'
import { issue_priority } from '#scripts/issue/issue-priority'
import { issue_run_hold } from '#scripts/issue/issue-run-hold'
import type { CarryAddition } from '#scripts/run/carry/run-carry-added'
import { run_add_epic, type TrackOutcome } from './run-add-epic'

// `josh run:add` — put an issue into a live `backlogrun`. A pool run picks an issue up only once it
// carries `auto-ok` and `run:lane`, and takes a `priority:high` one first; a `--only` run reads its
// named list off the carry record. **A running child is never interrupted**: an added issue takes the
// next lane that frees, ahead of the rest unless `--no-priority` puts it at the end. An epic is
// tracked as a root instead, unlabelled (`run-add-epic.ts`).
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
	// What the run already tracks, so an epic root is never recorded twice (`run_add_epic.tracked_of`).
	tracked?: ReadonlySet<number>
	// The issues whose repair attempt this call recorded (`run_repair_attempt.prepare`).
	repairs?: ReadonlySet<number>
}

const DEFAULT_CONTEXT: AddContext = { is_retry: false, done: [], active: new Set() }
const PROTECTED_LABELS = [NEEDS_DECISION_LABEL, NEEDS_HUMAN_REVIEW_LABEL, ALREADY_DONE_LABEL]

type AddOutcome =
	| TrackOutcome
	| { kind: 'queued'; issue: number; blockers: ReadonlyArray<number> }
	| { kind: 'closed'; issue: number }
	| { kind: 'unreadable'; issue: number }
	| { kind: 'unlabeled'; issue: number; label: string }
	| { kind: 'refused'; issue: number; reason: string }

const ISSUE_PREFIX = '#'
const BLOCKER_SEPARATOR = ', '

// A priority label already on the issue wins, as `issue:file` keeps one (`issue_priority.is_typed`);
// the queue position is the carry record's `is_priority`, not this label.
function labels_for(
	is_priority: boolean,
	existing: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
	const opted_in = [AUTO_OK_LABEL, RUN_LANE_LABEL]

	return is_priority && !issue_priority.is_typed(existing)
		? [...opted_in, PRIORITY_HIGH_LABEL]
		: opted_in
}

// The first label whose write failed, or `undefined` once every one landed. Sequential, so a
// refused write stops the rest rather than leaving a half-labelled issue the pool reads differently.
async function first_failed(
	issue: number,
	labels: ReadonlyArray<string>,
	write: AddPorts['apply_label'],
): Promise<string | undefined> {
	const [label, ...rest] = labels

	if (label === undefined) return undefined

	if (!(await write(issue, label))) return label

	return await first_failed(issue, rest, write)
}

// The stops a retry clears: `run:stalled` always, and `needs-human-merge` only for an issue whose
// repair attempt was recorded — a merge wait with no repair stays a person's (joshuafolkken/kit#7487).
// The ship re-parks it while the diff still needs a person's merge (`followup-human-merge.ts`).
function stops_of(issue: number, context: AddContext): ReadonlyArray<string> {
	if (!context.is_retry) return []

	return context.repairs?.has(issue) === true
		? [RUN_STALLED_LABEL, NEEDS_HUMAN_MERGE_LABEL]
		: [RUN_STALLED_LABEL]
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

// The label a person must clear before any add, `--retry` included, takes the issue.
function protected_label(labels: ReadonlyArray<string>): string | undefined {
	return PROTECTED_LABELS.find((label) => has_label_name(labels, label))
}

// The label that bars the issue from a run: `in-progress` bars it only where the shared reader says
// a run holds it (`issue-run-hold.ts`).
function label_refusal(labels: ReadonlyArray<string>): string | undefined {
	return protected_label(labels) ?? (issue_run_hold.is_held(labels) ? IN_PROGRESS_LABEL : undefined)
}

function refusal(issue: number, view: IssueView, context: AddContext): string | undefined {
	const labels = view.labels ?? []
	const label = label_refusal(labels)

	if (label !== undefined) return label
	if (context.active.has(String(issue))) return 'active lane'
	if (retry_required(issue, labels, context)) return 'use --retry'

	return terminal_refusal(issue, context)
}

async function label_one(
	issue: number,
	labels: ReadonlyArray<string>,
	ports: AddPorts,
	context: AddContext,
): Promise<AddOutcome> {
	const label = await first_failed(issue, labels, ports.apply_label)

	if (label !== undefined) return { kind: 'unlabeled', issue, label }

	const stop = await first_failed(issue, stops_of(issue, context), ports.clear_label)

	if (stop !== undefined) return { kind: 'refused', issue, reason: `could not clear ${stop}` }

	return { kind: 'queued', issue, blockers: [] }
}

// The outcome settled before any label is written — refused, or an epic tracked unlabelled — or
// `undefined` when the issue goes on to be labelled.
function decided(issue: number, view: IssueView, context: AddContext): AddOutcome | undefined {
	const reason = refusal(issue, view, context)

	if (reason !== undefined) return { kind: 'refused', issue, reason }

	return run_add_epic.is_epic(view.labels ?? [])
		? run_add_epic.track(issue, context.tracked)
		: undefined
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

	const settled = decided(issue, view, context)

	if (settled !== undefined) return settled

	const outcome = await label_one(issue, labels_for(is_priority, view.labels), ports, context)

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

// What this call put into the run: a queued issue, or an epic root the run did not track yet.
function is_added(outcome: AddOutcome): boolean {
	return outcome.kind === 'queued' || (outcome.kind === 'tracked' && outcome.is_new)
}

function additions_of(
	outcomes: ReadonlyArray<AddOutcome>,
	is_priority: boolean,
): ReadonlyArray<CarryAddition> {
	return outcomes
		.filter((outcome) => is_added(outcome))
		.map((outcome) => ({ issue: outcome.issue, is_priority }))
}

// The epic roots this call added: every run records them, where a pool run reads queued issues off
// their labels alone.
function roots_of(outcomes: ReadonlyArray<AddOutcome>): ReadonlySet<number> {
	return new Set(
		outcomes
			.filter((outcome) => outcome.kind === 'tracked' && outcome.is_new)
			.map((outcome) => outcome.issue),
	)
}

function blockers_text(blockers: ReadonlyArray<number>): string {
	return blockers.map((blocker) => `${ISSUE_PREFIX}${String(blocker)}`).join(BLOCKER_SEPARATOR)
}

function queued_line(issue: string, blockers: ReadonlyArray<number>, is_priority: boolean): string {
	if (blockers.length > 0) return `queued ${issue} · waiting: blocked by ${blockers_text(blockers)}`

	return `queued ${issue} · ${is_priority ? 'next free lane' : 'end of the queue'}`
}

function refused_reason(outcome: Exclude<AddOutcome, TrackOutcome | { kind: 'queued' }>): string {
	if (outcome.kind === 'closed') return 'closed'
	if (outcome.kind === 'unreadable') return 'could not be read'
	if (outcome.kind === 'refused') return outcome.reason

	return `could not apply \`${outcome.label}\``
}

// One line per issue, the outcome first, so a reader scanning the output sees which ones went in.
function describe(outcome: AddOutcome, is_priority: boolean): string {
	const issue = `${ISSUE_PREFIX}${String(outcome.issue)}`

	if (outcome.kind === 'queued') return queued_line(issue, outcome.blockers, is_priority)
	if (outcome.kind === 'tracked') return run_add_epic.describe(issue, outcome.is_new, is_priority)

	return `refused ${issue} · ${refused_reason(outcome)}`
}

// An epic root the run already tracked is in, as asked, so it fails nothing.
function is_all_added(outcomes: ReadonlyArray<AddOutcome>): boolean {
	return outcomes.every((outcome) => outcome.kind === 'queued' || outcome.kind === 'tracked')
}

const run_add = {
	add_all,
	additions_of,
	describe,
	is_all_added,
	labels_for,
	protected_label,
	roots_of,
}

export type { AddContext, AddOutcome, AddPorts, IssueView }
export { run_add }
