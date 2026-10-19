import { backlog_drive_restore } from '#scripts/backlog/backlog-drive-restore'
import type { SessionFigures } from '#scripts/cost-runtime/cost-cli'
import { issue_cite } from '#scripts/issue/issue-cite'
import type { HandoffLabels, ReportLabels } from '#scripts/report/report-labels'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_invocation } from '#scripts/run/run-invocation'

// `josh run:report --handoff` — the report a `backlogrun` writes when it hands the rest of a batch to a
// new session, generated from the values that already answer each line rather than filled in by hand:
// the run record (`run:carry`) names what merged, what is left and the command that resumes the run,
// the invocation's events name what parked, and `cost --cut`'s figures name why it stopped. **The
// hand-off is a fourth kind of stop**, so it carries the hand-off labels and never the completion
// report's `cause` / `fix` / `result` — an unfinished epic would read as finished.
//
// **The body is the Telegram body too**, as `run:report`'s is: the CLI prints it and sends it as the
// `confirmation`, the resume command as its `recommended` choice.

const LINE_SEPARATOR = '\n'
const LIST_SEPARATOR = ', '
const COST_COMMAND = '`pnpm josh cost --cut`'

interface HandoffInput {
	carry: RunCarry
	// This invocation's events, already scoped by `run-event-scope.ts`.
	events: ReadonlyArray<RunEvent>
	figures: SessionFigures
	labels: ReportLabels
}

interface Handoff {
	body: string
	// The command that resumes the run, or `undefined` for a record whose invocation does not parse.
	resume: string | undefined
}

function issue_list(issues: ReadonlyArray<number>, labels: HandoffLabels): string {
	if (issues.length === 0) return labels.none

	return issues.map((issue) => issue_cite.plain(issue)).join(LIST_SEPARATOR)
}

// The children that parked in this invocation and never merged — named apart from the remaining list,
// because a parked child is settled for this run but is not done.
function parked_of(input: HandoffInput): ReadonlyArray<number> {
	const merged = input.carry.merged_issues ?? []

	return [...backlog_drive_restore.parked_issues(input.events)].filter(
		(issue) => !merged.includes(issue),
	)
}

// **Never omitted**: it is the one line that tells this report from a completion report. A budget-only
// invocation named no list, so what is left is the pool rather than a count.
function remaining_line(input: HandoffInput, remaining: ReadonlyArray<number> | undefined): string {
	const labels = input.labels.handoff
	const parked = parked_of(input)
	const listed = remaining === undefined ? labels.pool : issue_list(remaining, labels)
	const count = remaining === undefined ? '' : ` (${String(remaining.length)})`
	const parked_note =
		parked.length === 0 ? '' : ` · ${labels.parked}: ${issue_list(parked, labels)}`

	return `${listed}${count}${parked_note}`
}

// An unmeasurable session quotes its verdict where the cost would be, never a `0`.
function measurement_line(figures: SessionFigures): string {
	const cost = figures.cost === undefined ? figures.verdict : String(figures.cost)

	return `${cost} / ${String(figures.threshold)}`
}

function command_line(resume: string | undefined, labels: HandoffLabels): string {
	return resume === undefined ? labels.none : `\`${resume}\``
}

function body_lines(
	input: HandoffInput,
	handoff_resume: string | undefined,
): ReadonlyArray<string> {
	const labels = input.labels.handoff
	const remaining = run_carry.remaining_of(input.carry)

	return [
		`**${labels.title}**`,
		'',
		`- **${labels.done}**: ${issue_list(input.carry.merged_issues ?? [], labels)}`,
		`- **${labels.remaining}**: ${remaining_line(input, remaining)}`,
		`- **${labels.why_stopped}**: ${COST_COMMAND} → ${input.figures.verdict}`,
		`- **${labels.next_command}**: ${command_line(handoff_resume, labels)}`,
		'',
		`**${input.labels.details}**`,
		'',
		`- ${labels.measurement}: ${measurement_line(input.figures)}`,
		`- ${labels.handover}: ${labels.handover_text}`,
	]
}

// Handed the same record, events and figures it returns the same report — nothing here reads a clock,
// the environment or the network, which is what the tests pin. The resume command is the record's own
// invocation: `run:carry` resumes a record only when the invocation matches it exactly, so a command
// shrunk to the remaining issues would be refused and its recovery would drop the carried counts.
function build_handoff(input: HandoffInput): Handoff {
	const resume = run_invocation.rebuild(input.carry.invocation)

	return { body: body_lines(input, resume).join(LINE_SEPARATOR), resume }
}

const run_report_handoff = {
	build_handoff,
}

export type { Handoff, HandoffInput }
export { run_report_handoff }
