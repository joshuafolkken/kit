import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { run_carry_added, type CarryAddition } from '#scripts/run/carry/run-carry-added'
import { run_invocation } from '#scripts/run/run-invocation'
import { run_board_single } from './run-board-single'

// Which plan a run covers, read off the invocation its carry record kept, so the board draws only what
// the run was asked to do. The invocation is parsed through the grammar the run itself uses, into the
// shape `backlog:plan` renders a named prefix from, so the board and the plan agree on it.
// An invocation that does not parse names nothing, which is the bare `backlogrun`'s plan. A single
// `fullrun #N` or `halfrun #N` covers its own issue alone (`run-board-single.ts`).
// The issues `run:add` handed the run join the declared ones in the order the driver works them
// (`run_carry_added.ordered`), so an `--only` run draws them too (joshuafolkken/kit#6836).
function scope_of(invocation: string, added?: ReadonlyArray<CarryAddition>): NamedPlan {
	return (
		run_board_single.scope_of(invocation) ?? {
			issues: run_carry_added.ordered(run_invocation.issue_numbers(invocation) ?? [], added),
			only: run_invocation.has_only(invocation),
		}
	)
}

const run_board_scope = { scope_of }

export { run_board_scope }
