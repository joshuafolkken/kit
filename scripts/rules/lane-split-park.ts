import type { GuardRun } from '#scripts/josh/hook-decision'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { bash_triggers } from './bash-triggers'
import { lane_park } from './lane-park'
import { shell_segments } from './shell-segments'
import { tail_commands } from './tail-commands'

// A dispatched lane child that split its own Issue is stopped from parking the epic it promoted.
//
// **A split is not a park.** On 2026-10-06, inside a `backlogrun`, the lane child for #3255 promoted
// its Issue to an epic with `pnpm josh epic --promote 3255`, filed #3291–#3294, then applied
// `needs-decision` to #3255 and sent a `confirmation` Telegram asking whether to run the epic. The
// children were already opted in, so the question had no answer to wait for, and the same run's child
// for #3247 had split without parking. `backlogrun-park.md` → "Splitting a child mid-run" says
// splitting alone never adds `needs-decision` to the promoted epic; the parent reads an open Issue that
// carries `epic` as a split (`run-merge.ts`), so the label is never what tells it.
//
// **The material is the run's own calls.** The promotion is a `josh epic --promote <N>` this run issued,
// read off the transcript tail as `filing-cap.ts` reads its filings — a tool call, never prose, so a
// child that merely read a document quoting the command is not mistaken for one that ran it. Only a
// promotion of the dispatched issue counts: the epic a mid-run split promotes is the child's own Issue.

// `josh epic`, named canonically — `shell_segments.is_josh_command` expands an alias before the match.
const EPIC_COMMANDS: ReadonlySet<string> = new Set(['epic'])
const PROMOTED_ISSUE = /--promote[=\s]+["']?(?<issue>\d+)\b/u
// The issue a label write targets, in the two spellings `lane_park.records_the_park` accepts: the REST
// path `…/issues/<N>/labels` and `gh issue edit <N>`.
const LABEL_TARGETS: ReadonlyArray<RegExp> = [
	/\/issues\/(?<issue>\d+)\/labels\b/u,
	/\bissue\s+edit\s+["']?(?<issue>\d+)\b/u,
]
// The issue a confirmation notify is about, read off its `--issue-url` the way `stop-rules.ts` spells it.
const ISSUE_URL = /--issue-url[=\s]+["']?([^\s"']+)/u
const URL_ISSUE = /\/issues\/(\d+)\b/u

function promoted_in(segment: string): string | undefined {
	if (!shell_segments.is_josh_command(segment, EPIC_COMMANDS)) return undefined

	return PROMOTED_ISSUE.exec(segment)?.groups?.['issue']
}

// Every issue a `josh epic --promote` among these commands promoted.
function promoted_issues(commands: ReadonlyArray<string>): ReadonlySet<string> {
	const segments = commands.flatMap((command) => shell_segments.segments_of(command))
	const issues = segments.map((segment) => promoted_in(segment))

	return new Set(issues.filter((issue) => issue !== undefined))
}

function label_target(command: string): string | undefined {
	for (const pattern of LABEL_TARGETS) {
		const issue = pattern.exec(command)?.groups?.['issue']

		if (issue !== undefined) return issue
	}

	return undefined
}

// **Both acts of the park are refused: the label write and the stop Telegram.** Refusing the label
// alone left the notify to `lane-park`, whose once-per-run refusal asks for this very label and lets the
// reissue through, so the Telegram still went out. This row is listed before `lane-park` and shares the
// notify with it — an overlap that is safe because a run that promoted nothing is left to `lane-park`
// (`decide` answers false and the call falls through). Either act onto another issue — the leftover
// child the procedure does park — is not the epic's park, so it is left alone.
function is_park_of(command: string, issue: string): boolean {
	return lane_park.records_the_park(command) && label_target(command) === issue
}

function notified_issue(command: string): string | undefined {
	const [, url = ''] = ISSUE_URL.exec(command) ?? []
	const [, issue] = URL_ISSUE.exec(url) ?? []

	return issue
}

function is_notify_of(command: string, issue: string): boolean {
	return lane_park.is_confirmation_notify(command) && notified_issue(command) === issue
}

// **The command test comes first and the world is consulted second**, exactly as `lane-park.ts` gates
// its own read: a person working in a lane carries no mark and sees no refusal.
function is_candidate(command: string): boolean {
	const issue = lane_child_marker.marked_issue()

	if (issue === undefined) return false
	if (!is_park_of(command, issue) && !is_notify_of(command, issue)) return false

	return lane_child_marker.is_child_of(process.cwd())
}

// Refused only once the run has promoted the dispatched issue, and on every occurrence: a split child
// must never park its epic, so the route is always "return the split", never a reissue.
function decide(_call: unknown, run: GuardRun): boolean {
	const issue = lane_child_marker.marked_issue()
	const commands = tail_commands.prior_bash_commands(time_density_hook.read_tail(run.transcript))

	return issue !== undefined && promoted_issues(commands).has(issue)
}

const LANE_SPLIT_PARK_REASON =
	'⛔ lane split park: this session is a dispatched lane child that promoted its own Issue to an epic ' +
	'this run, and a split is not a park — do not apply `needs-decision` to the promoted epic and do not ' +
	'send a `confirmation` Telegram. The parent reads an open Issue carrying `epic` as a split and ' +
	'continues through its children; a question here has nobody to answer it (joshuafolkken/kit#3296, ' +
	'measured 2026-10-06 when the child for #3255 parked its promoted epic). If what remains of the ' +
	'original work needs a person, park that child issue instead, then end the turn. The procedure is ' +
	'`.claude/skills/workflow-commands/backlogrun-park.md` → "Splitting a child mid-run". This rule fires ' +
	'on every occurrence, not once per run.'

// It declares no `keeps`: not parking is the absence of a call, so the row is reported unmeasured
// rather than scored on an act that does not exist (`lane-carry-conflict.ts`).
const ROW = {
	id: 'lane-split-park',
	is_trigger: bash_triggers.on_bash_command(is_candidate),
	reason: LANE_SPLIT_PARK_REASON,
	decide,
}

const lane_split_park = {
	LANE_SPLIT_PARK_REASON,
	ROW,
	promoted_issues,
}

export { lane_split_park }
