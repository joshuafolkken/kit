import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_handoff } from '#scripts/lane/lane-handoff'
import { run_park } from '#scripts/run/park/run-park'
import { bash_triggers } from './bash-triggers'
import { shell_segments } from './shell-segments'

// A dispatched lane child records its park before it stops, delivered at the call it binds on.
//
// **A lane child that stops for a decision must leave the question behind.** A `backlogrun`
// dispatches a child as a detached `fullrun #<N>` process, and its only route to ask a person
// anything is to park the Issue — `needs-decision` plus a comment carrying the question. A child that
// writes the question only into its final message leaves the parent an OPEN Issue with `in-progress`
// and no question, and a person looking at the Issue cannot tell what to answer. The child is the one
// process that knows the question, the options and whether it stashed, and that knowledge dies with
// its turn.
//
// **The stop is one shell call, so the rule is delivered rather than resident.** `CLAUDE.md` mandates
// a `confirmation` Telegram before any mid-workflow stop, so `pnpm josh notify --task-type
// confirmation` is the call every lane-child stop passes through. The agent that obeys this is always
// a `claude -p` child, so the rule leaves residency entirely (`prompts/collaboration-workflow/rule-delivery.md`).
//
// **A parked child is silent, read off the local park record.** The park is a label on GitHub, which a
// `PreToolUse` guard cannot read (it answers synchronously, network calls are out), and scanning the
// transcript tail for the label is unsafe: a child that merely *read* `backlogrun-park.md` would look
// compliant. So `pnpm josh run:park` writes a local record once the comment and the label are both on
// the issue, and the guard reads it synchronously, the way the pre-gate cut guard reads the cut record
// (joshuafolkken/kit#4132). A child with no record still gets the once-per-run checklist.

// `josh notify`, named canonically — `shell_segments.is_josh_command` expands an alias before the match.
const NOTIFY_COMMANDS: ReadonlySet<string> = new Set(['notify'])
// The task type that marks a stop waiting on a person, taken quoted or bare so `--task-type
// confirmation` and `--task-type=confirmation` read alike. A `progress` or `pr` notification is not a
// stop and never matches.
const CONFIRMATION_TASK_TYPE = /(?:^|\s)--task-type[=\s]+["']?confirmation\b/u

// A segment that sends the mid-workflow-stop Telegram. Segment-wise and alias-expanded for the reason
// every predicate in this directory is: one shell line carries several commands, and a name quoted
// inside a body is not the command being invoked.
function is_confirmation_notify(command: string): boolean {
	return shell_segments
		.segments_of(command)
		.some(
			(segment) =>
				shell_segments.is_josh_command(segment, NOTIFY_COMMANDS) &&
				CONFIRMATION_TASK_TYPE.test(segment),
		)
}

// The josh notify invocation in either spelling, anywhere in a blob of text. The stop guard
//  asks whether a confirmation notify was issued *this turn* by scanning the
// transcript tail rather than one command, so the "is it a stop notification" judgement stays here —
// the same `CONFIRMATION_TASK_TYPE` regex, never a second copy of it.
const NOTIFY_INVOCATION = /josh\s+(?:notify|nf)\b/u

// **A blob, not a single command, so it cannot be segmented.** The tail is raw transcript text with a
// notify command embedded in a JSONL string, so the two halves are tested against the whole: a josh
// notify appears and a `--task-type confirmation` appears. That is looser than `is_confirmation_notify`
// on purpose — the guard's safe direction is to read a real stop notification as present, so a run
// that sent one is never told it did not.
//
// **A command that sent the Telegram itself prints this line instead**:
// `run:entry` notifies from inside its own stop, so no `josh notify` invocation reaches the transcript,
// and the line it prints is what the tail carries. One constant, printed there and matched here.
const COMMAND_NOTIFY_MARKER = 'stop notified: a confirmation Telegram was sent by this command'

function mentions_confirmation_notify(text: string): boolean {
	if (text.includes(COMMAND_NOTIFY_MARKER)) return true

	return NOTIFY_INVOCATION.test(text) && CONFIRMATION_TASK_TYPE.test(text)
}

// **The command test comes first and the world is consulted second**, so the `is_child_of` read — the
// dispatch mark against this checkout's own issue — runs only on the handful of calls that are a
// confirmation stop, not on every `Bash` call in the run. `is_child_of` is the same mechanical
// human-or-child fact the pre-gate cut reads: a person working in a lane carries no mark and sees no
// refusal, and a mark that leaked in naming another issue is read as a person too.
//
// **A child that handed its region to the detached ship is not parking**: its
// stop waits on nobody, so the park checklist is the wrong advice. `lane_handoff.is_handed_off` is the
// reading the `Stop` hook stands its notify demand down on, so the two hooks cannot disagree.
function is_parking_child(directory: string = process.cwd()): boolean {
	return lane_child_marker.is_child_of(directory) && !lane_handoff.is_handed_off(directory)
}

// A parking child that has not parked yet: `run:park` left no record for its issue in this repository.
// Kept apart from `is_parking_child`, which `run:entry` reads to leave a lane child's stop to this row
// whether or not it has parked.
function is_unparked_child(directory: string = process.cwd()): boolean {
	if (!is_parking_child(directory)) return false

	const issue = lane_child_marker.marked_issue()

	return issue === undefined || !run_park.is_parked_sync(issue, directory)
}

function is_unparked_stop(command: string, is_child: () => boolean = is_unparked_child): boolean {
	if (!is_confirmation_notify(command)) return false

	return is_child()
}

// **Keeping this rule is applying `needs-decision`**, the one act the park asks for before the stop.
// It reads an actual `Bash` command — `josh run:park`, or a label application by REST or by
// `gh issue edit` — never the transcript tail, so a doc read that quotes the command is not mistaken
// for the run making it. `run:park --clear` takes the park off, so it is not one.
const APPLIES_NEEDS_DECISION = new RegExp(
	String.raw`(?:labels\[\]=|--add-label[= ]'?)${NEEDS_DECISION_LABEL}\b`,
	'u',
)
const PARK_COMMANDS: ReadonlySet<string> = new Set(['run:park'])
const CLEAR_FLAG = /(?:^|\s)--clear\b/u

function is_park_command(segment: string): boolean {
	return shell_segments.is_josh_command(segment, PARK_COMMANDS) && !CLEAR_FLAG.test(segment)
}

function records_the_park(command: string): boolean {
	if (APPLIES_NEEDS_DECISION.test(command)) return true

	return shell_segments.segments_of(command).some((segment) => is_park_command(segment))
}

// The instruction in the shape a refusal can carry: what the stop must leave behind, how to record it,
// and the reissue sentence every delivery needs. **The park procedure is named, not restated** — the
// single source is `backlogrun-park.md` → "park and continue", and a second copy here would be the
// clone `CLAUDE.md` prohibits.
const LANE_PARK_REASON =
	'⛔ lane child park: this session is a dispatched lane child, so a stop for a person parks first: ' +
	'`pnpm josh run:park <N> --body-file <path>` (question, options, stash — it applies ' +
	'`needs-decision`); a ' +
	'`needs-human-review` / `already-done` stop already is. Reissue this notify, once per run ' +
	'(`.claude/skills/workflow-commands/pre-gate-cut.md`).'

// The row itself, so `delivered-rules.ts` spreads one entry. **Once per run rather than `decide`.** The
// stop ends the turn, so it is not the recurring act `decide` is for. A parked child is excluded in the
// trigger itself (`is_unparked_child`), so the park record is the satisfaction and no
// `already_satisfied` reads the tail. `keeps` reads an actual park `Bash` command, never the tail, so a
// doc read that quotes one is not mistaken for it.
const ROW = {
	id: 'lane-park',
	is_trigger: bash_triggers.on_bash_command(is_unparked_stop),
	reason: LANE_PARK_REASON,
	keeps: bash_triggers.on_bash_command(records_the_park),
	about: {
		title: 'Lane child park',
		topic: '`.claude/skills/workflow-commands/pre-gate-cut.md`',
		fires: 'a dispatched lane child issuing `pnpm josh notify --task-type confirmation`',
		quiet: 'not a lane child, or not a stop notification',
	},
}

const lane_park = {
	COMMAND_NOTIFY_MARKER,
	LANE_PARK_REASON,
	ROW,
	is_confirmation_notify,
	is_parking_child,
	is_unparked_child,
	is_unparked_stop,
	mentions_confirmation_notify,
	records_the_park,
}

export { lane_park }
