import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { run_invocation } from '#scripts/run/run-invocation'

// Which plan a run covers, read off the invocation its carry record kept, so the board draws only what
// the run was asked to do. The invocation is parsed through the grammar the run itself uses, into the
// shape `backlog:plan` renders a named prefix from, so the board and the plan agree on it.
// An invocation that does not parse names nothing, which is the bare `backlogrun`'s plan.
function scope_of(invocation: string): NamedPlan {
	return {
		issues: run_invocation.issue_numbers(invocation) ?? [],
		only: run_invocation.has_only(invocation),
	}
}

const run_board_scope = { scope_of }

export { run_board_scope }
