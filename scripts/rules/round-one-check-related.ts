import type { GuardRun } from '#scripts/josh/hook-decision'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { time_markers } from '#scripts/time-runtime/time-markers'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { time_transcript_line, type Block } from '#scripts/time-runtime/time-transcript-line'
import { bash_triggers } from './bash-triggers'
import { shell_segments } from './shell-segments'
import { tail_commands } from './tail-commands'

// A lane child is stopped from running `check:related` on round 1's fixes before it joins the review.
//
// **Ship reruns the scoped pair on the fixed tree.** `chain-rule.md` → "A lane child" says the round's
// fixes take no `check:related` unless a brief follows: `josh ship`'s pre-detach checks the tree the
// fixes left. The #5168 lane fixed two findings between its brief and `run:review --join` and ran
// `check:related` after each, a sizeable share of its run, because the sentence was prose with no delivery.
//
// **The material is the run's own calls, read in order off the transcript tail.** The brief is a
// `run:review` in its writing mode, the fix an `Edit` / `Write` after it, and the round closes at
// `run:review --join` or `ship --detach`. Neither the brief file nor the join leaves a record on disk
// that tells "briefed, not yet joined" apart, so the tail is the one source that can answer.

// Named canonically — `shell_segments.is_josh_command` expands an alias (`josh cr`) before the match.
const CHECK_COMMANDS: ReadonlySet<string> = new Set(['check:related'])
// `run:chain` opens the brief at its `run:review` stage, and `run:chain --join` closes the round (#5752).
const REVIEW_COMMANDS: ReadonlySet<string> = new Set(['run:review', 'run:chain'])
const SHIP_COMMANDS: ReadonlySet<string> = new Set(['ship'])
const JOIN_FLAG = /(?:^|\s)--join(?:[=\s]|$)/u
// The `run:review` modes that read a running check rather than write a brief.
const READING_MODE_FLAG = /(?:^|\s)--(?:pinned|push)(?:[=\s]|$)/u
const DETACH_FLAG = /(?:^|\s)--detach(?:[=\s]|$)/u

type RoundEvent = 'brief' | 'close' | 'edit' | 'none'

function review_event(segment: string): RoundEvent {
	if (JOIN_FLAG.test(segment)) return 'close'

	return READING_MODE_FLAG.test(segment) ? 'none' : 'brief'
}

function segment_event(segment: string): RoundEvent {
	if (shell_segments.is_josh_command(segment, REVIEW_COMMANDS)) return review_event(segment)

	const is_detach =
		shell_segments.is_josh_command(segment, SHIP_COMMANDS) && DETACH_FLAG.test(segment)

	return is_detach ? 'close' : 'none'
}

function block_events(block: Block): ReadonlyArray<RoundEvent> {
	if (tail_commands.is_bash_use(block)) {
		const segments = shell_segments.segments_of(time_shell.bash_command(block.input))

		return segments.map((segment) => segment_event(segment))
	}

	const is_edit = time_markers.tool_marker(block.name, block.input) === time_markers.EDIT_MARKER

	return is_edit ? ['edit'] : []
}

// Whether the tail's last brief was followed by a fix and by neither a join nor a detach.
function fixes_an_open_round(tail: string): boolean {
	const blocks = time_transcript_line.parse_text(tail).flatMap((line) => line.blocks)
	const events = blocks.flatMap((block) => block_events(block))
	const brief_at = events.lastIndexOf('brief')

	if (brief_at === -1) return false

	const since_brief = new Set(events.slice(brief_at))

	return since_brief.has('edit') && !since_brief.has('close')
}

function runs_check_related(command: string): boolean {
	return shell_segments
		.segments_of(command)
		.some((segment) => shell_segments.is_josh_command(segment, CHECK_COMMANDS))
}

// **The command test comes first and the world is consulted second**: a person working in a lane
// carries no mark and sees no refusal.
function is_candidate(command: string): boolean {
	if (!runs_check_related(command)) return false

	return lane_child_marker.is_child_of(process.cwd())
}

// Refused on every occurrence while the round stays open: the way on is the join, never a reissue.
function decide(_call: unknown, run: GuardRun): boolean {
	return fixes_an_open_round(time_density_hook.read_tail(run.transcript))
}

const ROUND_ONE_CHECK_RELATED_REASON =
	"⛔ round-one check:related: round 1's fixes need no `check:related` — ship's pre-detach reruns the " +
	'scoped pair on the fixed tree; refused on every occurrence. Go on to `pnpm josh run:review --join`; ' +
	'`--join --fixing` while round 1 has fixes to make (`.claude/skills/workflow-commands/chain-rule.md` → "A lane child").'

// It declares no `keeps`: skipping the check is the absence of a call, so the row is reported
// unmeasured rather than scored on an act that does not exist (`lane-split-park.ts`).
const ROW = {
	id: 'round-one-check-related',
	is_trigger: bash_triggers.on_bash_command(is_candidate),
	reason: ROUND_ONE_CHECK_RELATED_REASON,
	decide,
	about: {
		title: "No check:related on round 1's fixes",
		topic: '`.claude/skills/workflow-commands/chain-rule.md` → "A lane child"',
		fires:
			"`pnpm josh check:related` (`josh cr`) in a lane child after an `Edit` / `Write` that follows `run:review`'s (or `run:chain`'s) brief, before `run:review --join`, `run:chain --join` or `ship --detach`. Every occurrence",
		quiet: 'no fix since the brief, already joined or detached, or not a lane child',
	},
}

const round_one_check_related = {
	ROUND_ONE_CHECK_RELATED_REASON,
	ROW,
	fixes_an_open_round,
}

export { round_one_check_related }
