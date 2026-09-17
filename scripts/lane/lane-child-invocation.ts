import { run_issue_number } from '#scripts/run/run-issue-number'

const CHILD_INVOCATION = 'fullrun'
const RESUME_GUIDE = '.claude/skills/workflow-commands/pre-gate-cut.md'

function child_invocation(issue: string): string {
	run_issue_number.require_issue_number(issue)

	return `${CHILD_INVOCATION} #${issue}`
}

function resume_invocation(issue: string): string {
	const preamble = `Resuming the lane child for issue #${issue} — do not re-read the workflow-commands entry documents (SKILL.md, fullrun.md). Run \`pnpm josh run:cut --resume ${issue}\` before anything else and follow the matching verdict in ${RESUME_GUIDE}: \`resume\` goes to the gate, \`resume-impl\` continues implementation. Only on \`fresh\` proceed as an ordinary`

	return `${preamble} ${child_invocation(issue)}`
}

const lane_child_invocation = { CHILD_INVOCATION, child_invocation, resume_invocation }

export { lane_child_invocation }
