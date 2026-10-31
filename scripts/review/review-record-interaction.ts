import { error_text } from '#scripts/lib/error-message'
import { review_interaction } from './review-interaction'

// What `josh review:record` says about the interaction review (`review-interaction.ts`).
//
// **A round-1 fix can make the pass due after its brief opened** (joshuafolkken/kit#4835): the fix
// reaches the run tooling the original change did not, so round 1 opened with `/code-review`'s brief
// alone. A recorded code round reads the pass's status over the fixed tree and names its brief, so the
// lane runs it before `josh ship` instead of the ship's review stage running it alone and stopping on
// its finding. A status git could not read prints nothing — the merge gate still refuses a missing pass.

const NOT_REQUIRED_LINE =
	'No interaction review is due: the change touches no run tooling, or this checkout keeps no ledger.'
const DUE_HEAD = 'Interaction review now due'

// An interaction reviewer that already ran beside round 1 is only recorded, never run twice.
function due_line(issue: number): string {
	return `${DUE_HEAD}: this round’s change touches the run tooling and no interaction pass is recorded. Before \`josh ship\`, record it with \`pnpm josh review:record --from-slot --interaction --issue ${String(issue)} [<n>=<disposition> ...]\` — if no interaction reviewer ran beside this round, first open its brief with \`pnpm josh review:brief --interaction\` and run that \`reviewer\` — so a finding is fixed in this lane rather than stopping the ship.`
}

async function report_due(issue: number, root: string): Promise<void> {
	try {
		if ((await review_interaction.status(issue, root)) === 'missing') console.info(due_line(issue))
	} catch (error) {
		error_text.trace_swallowed('review_record_interaction.report_due', error)
	}
}

const review_record_interaction = {
	due_line,
	NOT_REQUIRED_LINE,
	report_due,
}

export { review_record_interaction }
