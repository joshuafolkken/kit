import { run_issue_number } from '#scripts/run/run-issue-number'

const CHILD_INVOCATION = 'fullrun'
const RESUME_GUIDE = '.claude/skills/workflow-commands/pre-gate-cut.md'

function child_invocation(issue: string): string {
	run_issue_number.require_issue_number(issue)

	return `${CHILD_INVOCATION} #${issue}`
}

// The `pgrep -f` pattern that finds a running child: the invocation is always the last argument of
// its command line — the resume prompts below end with it on purpose — so the anchor matches every
// launch of `#<N>` and never `#<N>0` (joshuafolkken/kit#2421).
function process_pattern(issue: string): string {
	return `${child_invocation(issue)}$`
}

function resume_invocation(issue: string): string {
	const preamble = `Resuming the lane child for issue #${issue} — do not re-read the workflow-commands entry documents (SKILL.md, fullrun.md). Run \`pnpm josh run:cut --resume ${issue}\` before anything else and follow the matching verdict in ${RESUME_GUIDE}: \`resume\` goes to the gate, \`resume-impl\` continues implementation. Only on \`fresh\` proceed as an ordinary`

	return `${preamble} ${child_invocation(issue)}`
}

// The prompt an `outage` re-dispatch gives a resumed child (joshuafolkken/kit#2317). Its session was
// relaunched with `--resume`, so its full context is already loaded — the preamble tells it not to
// re-read the entry documents and to find where it stopped with `run:step`, redoing only the last
// action if it did not complete.
//
// **It ends with `child_invocation` on purpose, not as decoration** — for the same reason
// `resume_invocation` does: the parent's liveness poll is `pgrep -laf "<invocation>$"`, so the trailing
// `fullrun #<N>` keeps the relaunched process matching, and it is the ordinary run the child carries on.
function outage_resume_invocation(issue: string): string {
	const preamble = `Resuming the lane child for issue #${issue} after an API disconnection — your session was restored with its full context, so do not re-read the workflow-commands entry documents (SKILL.md, fullrun.md). Continue the run from where it stopped: run \`pnpm josh run:step ${issue}\` to find the next action, redoing only the last step if it did not complete.`

	return `${preamble} ${child_invocation(issue)}`
}

const lane_child_invocation = {
	CHILD_INVOCATION,
	child_invocation,
	outage_resume_invocation,
	process_pattern,
	resume_invocation,
}

export { lane_child_invocation }
