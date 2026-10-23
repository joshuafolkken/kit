import { bash_triggers } from './bash-triggers'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `timed-rerun` row of `delivered-rules.ts`
// (joshuafolkken/kit#4356). A lane agent timed a whole-tree `eslint` twice to learn what CI already
// records, and each run took about 1.3 cores for seven minutes outside the core budget.
//
// **The timer is the trigger, not the tool.** What a run is after when it prefixes `time` or reaches
// for `hyperfine` is a duration, and a duration of CI or of the gate is already on record — the Actions
// jobs and the lane ledger. The tool under the timer can be anything, so reading the timer is the one
// trigger that does not have to enumerate them.
//
// **Once per run.** The rule allows one re-run when the record cannot answer, so the reissue goes
// through. On that reissue `lane-direct-tool` still refuses a lane child's `time`-prefixed heavy tool
// (`git_argv` skips the timer) and points it at `pnpm josh reserved-run`, the overlap
// `delivered-rules.ts` admits. A `hyperfine "<command>"` carries the tool inside a quoted argument,
// which `lane-direct-tool` does not read, so in a lane that reissue is not budgeted.

// A segment that opens with a timer, behind any environment assignments: `time`, `/usr/bin/time -p`
// and `hyperfine`. Anchored at the segment start, so a quoted mention or an argument is not a timer.
const TIMED_SEGMENT = /^\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:\S*\/)?(?:time|hyperfine)\s/u

function is_timed_run(command: string): boolean {
	return shell_segments
		.quote_aware_commands_of(command)
		.some((segment) => TIMED_SEGMENT.test(segment))
}

// Reading the record: an Actions run or job listing, or the lane ledger's gate timings.
const RECORD_READ = /\bgh\s+api\b.*\/actions\/runs\b|\bjosh\s+(?:lane:stats|lst)\b/u

function reads_the_record(command: string): boolean {
	return RECORD_READ.test(command)
}

function measures_duration(command: string): boolean {
	return reads_the_record(command) || is_timed_run(command)
}

const TIMED_RERUN_REASON =
	'⛔ timed re-run: a CI or gate duration is already on record — read the Actions jobs with ' +
	'`gh api …/actions/runs/<run_id>/jobs` or the gate timings with `pnpm josh lane:stats`. Re-run ' +
	'only when the record cannot answer: reissue the same command once, and post the result on the ' +
	'Issue (`prompts/collaboration-workflow/measurement.md`).'

// The row itself, so `delivered-rules.ts` spreads one entry; once per run, so the one allowed re-run
// goes through on the reissue.
const ROW = {
	id: 'timed-rerun',
	is_trigger: bash_triggers.on_bash_command(is_timed_run),
	reason: TIMED_RERUN_REASON,
	keeps: bash_triggers.on_bash_command(reads_the_record),
	reaches: bash_triggers.on_bash_command(measures_duration),
	about: {
		title: 'Timed re-run',
		topic: '`measurement.md`',
		fires: 'a command timed with `time` / `/usr/bin/time` / `hyperfine`',
		quiet: 'the duration is read from the Actions jobs or `pnpm josh lane:stats`',
	},
}

const timed_rerun = {
	ROW,
	TIMED_RERUN_REASON,
	is_timed_run,
	reads_the_record,
}

export { timed_rerun }
