import { NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { shell_segments } from './shell-segments'

// A dispatched lane child records its park before it stops, delivered at the call it binds on
// (joshuafolkken/kit#2034).
//
// **A lane child that stopped for a decision left no question behind.** A `backlogrun` dispatches a
// child as a detached `fullrun #<N>` process, and its only route to ask a person anything is to park
// the Issue — `needs-decision` plus a comment carrying the question. Measured twice in one run on
// 2026-09-14: #2012's child had its `AskUserQuestion` refused (it is headless), wrote the question
// into its final message, sent a `confirmation` Telegram and exited; #2011 wrote a Tier B decision to
// its final message and exited the same way. Neither left a label or a comment, so the parent found an
// OPEN Issue with `in-progress` and no question, and a person looking at the Issue could not tell what
// to answer. The child is the one process that knows the question, the options and whether it stashed,
// and that knowledge died with its turn.
//
// **The stop is one shell call, so the rule is delivered rather than resident.** `CLAUDE.md` mandates
// a `confirmation` Telegram before any mid-workflow stop, so `pnpm josh notify --task-type
// confirmation` is the call every lane-child stop passes through. The agent that obeys this is always
// a `claude -p` child, so the rule leaves residency entirely (`prompts/collaboration-workflow/rule-delivery.md`).
//
// **Why once per run and not a synchronous compliance check.** The pre-gate cut can stay silent on a
// compliant run because the cut record is a local file it reads synchronously; the park is a label on
// GitHub, which a `PreToolUse` guard cannot read (it answers synchronously, network calls are out).
// Scanning the transcript tail for the label instead is unsafe in the one direction that matters: a
// child that merely *read* `backlogrun-park.md`, whose prose carries the very `labels[]=needs-decision`
// command, would look compliant and the guard would fall silent on a real violation — the whole bug,
// reappearing inside its own check. So the row carries no `already_satisfied`: it fires once per run on
// the stop, the reason is a checklist rather than an accusation, and a child that already parked simply
// reissues. One wasted round trip on the compliant path is the safe direction; a missed park is not.

// `josh notify`, in either spelling — the alias `nf` is expanded to `notify` before this sees it, the
// same way `pre-gate-cut.ts` matches `gate` through `ga`.
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

// **The command test comes first and the world is consulted second**, so the `is_child_of` read — the
// dispatch mark against this checkout's own issue — runs only on the handful of calls that are a
// confirmation stop, not on every `Bash` call in the run. `is_child_of` is the same mechanical
// human-or-child fact the pre-gate cut reads: a person working in a lane carries no mark and sees no
// refusal, and a mark that leaked in naming another issue is read as a person too.
function is_unparked_stop(
	command: string,
	is_lane_child: boolean = lane_child_marker.is_child_of(process.cwd()),
): boolean {
	if (!is_confirmation_notify(command)) return false

	return is_lane_child
}

// **Keeping this rule is applying `needs-decision`**, the one act the park asks for before the stop.
// It reads an actual `Bash` command — a label application by REST or by `gh issue edit` — never the
// transcript tail, so a doc read that quotes the command is not mistaken for the run making it.
const APPLIES_NEEDS_DECISION = new RegExp(
	String.raw`(?:labels\[\]=|--add-label[= ]'?)${NEEDS_DECISION_LABEL}\b`,
	'u',
)

function records_the_park(command: string): boolean {
	return APPLIES_NEEDS_DECISION.test(command)
}

// The instruction in the shape a refusal can carry: what the stop must leave behind, how to record it,
// and the reissue sentence every delivery needs. **The park procedure is named, not restated** — the
// single source is `backlogrun-park.md` → "park and continue", and a second copy here would be the
// clone `CLAUDE.md` prohibits.
const LANE_PARK_REASON =
	'⛔ lane child park: this session is a dispatched lane child, and a stop that waits on a person must ' +
	'leave the question on the Issue before it sends this Telegram — otherwise the parent finds an OPEN ' +
	'Issue with `in-progress` and no question, and a person cannot tell what to answer ' +
	'(joshuafolkken/kit#2034 measured this twice in one run). The child is the only process that knows ' +
	'the question, the options and whether it stashed, so it records the park itself rather than leaving ' +
	'the parent to guess from a log. Before you notify and stop: apply `needs-decision` and post a ' +
	'comment carrying the question, the options, and whether work was stashed — ' +
	"`gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=needs-decision'` then " +
	'`gh api repos/{owner}/{repo}/issues/<N>/comments --field body=@<path>`. If this stop is a ' +
	'`needs-human-review` or `already-done` one, that label is already on the Issue and there is nothing ' +
	'to add. Then reissue this notify — it fires once per run and cannot repeat on the call in hand. The ' +
	'procedure is `.claude/skills/workflow-commands/pre-gate-cut.md` → "A lane child records its park ' +
	'before it stops", and the park itself is `backlogrun-park.md` → "park and continue".'

const lane_park = {
	LANE_PARK_REASON,
	is_confirmation_notify,
	is_unparked_stop,
	records_the_park,
}

export { lane_park }
