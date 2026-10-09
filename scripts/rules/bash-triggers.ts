import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { shell_segments } from './shell-segments'

// The trigger helpers the enumeration in `delivered-rules.ts` is built from, held here so a rule
// that lives in its own module can build its own row without importing the enumeration back.
// `is_issue_filing` is the one three rows share — the WIP cap, the per-run
// filing cap and the fold — so it could not stay a private function of the file that spreads their rows.

// **Only `Bash`, and the omission is deliberate**: Claude Code denies one
// call of a turn and runs the rest, so a refused `Edit` would leave its siblings applied and itself
// not. Every rule delivered by the enumeration is therefore one whose binding moment is a shell call —
// so the tool-name guard belongs here rather than to each row, and a row states only what it looks for
// in the command.
function on_bash_command(is_match: (command: string) => boolean): (call: GuardedCall) => boolean {
	return function is_trigger(call: GuardedCall): boolean {
		if (call.name !== cost_blocks.BASH_TOOL) return false

		return is_match(time_shell.bash_command(call.input))
	}
}

// `gh issue create`, in any of the spellings a run reaches for.
const ISSUE_CREATE_COMMAND = /\bgh\s+(?:\S+\s+)*?issue\s+create\b/u
// `gh api …/issues` — the path segment has to *end* there, so a comment endpoint
// (`…/issues/1524/comments`) and a listing under it are both left alone.
const ISSUES_ENDPOINT = /repos\/[^\s'"]*\/issues(?=$|["'\s])/u
// A title field is what separates the POST that files from the GET that lists: `gh api …/issues`
// with no field is a listing, and a listing files nothing. **All four spellings**, `-F` included —
// it is `--field`'s short form and reads as a different flag to a pattern that only knows `-f`.
// A body passed with `--input <file>` carries the title inside the file and is not visible here;
// that limit is recorded beside the non-`gh` one in `prompts/collaboration-workflow/rule-delivery.md`.
const TITLE_FIELD = /(?:-f|-F|--field|--raw-field)\s*'?title=/u

// A filing made by hand rather than through `josh issue:file` — the call the `direct-filing` row
// refuses on every occurrence.
function is_direct_filing(command: string): boolean {
	if (ISSUE_CREATE_COMMAND.test(command)) return true

	return ISSUES_ENDPOINT.test(command) && TITLE_FIELD.test(command)
}

// `pnpm josh issue:file`, in either spelling — **the** filing act once a direct one is refused, so the
// run-level filing rows (the WIP cap, the per-run cap, the fold) trigger on it. Segment-wise, so a
// spelling quoted inside another command's body is not read as a filing.
const FILING_NAMES: ReadonlySet<string> = new Set(['issue:file'])

function is_issue_filing(command: string): boolean {
	return shell_segments
		.segments_of(command)
		.some((segment) => shell_segments.is_josh_command(segment, FILING_NAMES))
}

const bash_triggers = { is_direct_filing, is_issue_filing, on_bash_command }

export { bash_triggers }
