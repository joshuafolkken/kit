import { has_label_name, NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'

// Whether an issue is parked for a person — the `needs-decision` label — read live, so a session a
// lane's broker would start for it is refused once the run has parked it (joshuafolkken/kit#3878).
//
// **An issue whose state cannot be read is not parked**: the read gates every brokered review, so
// reading an outage as a park would fail every review in flight for as long as GitHub is away.

async function is_parked(issue: string): Promise<boolean> {
	const read = await issue_state_cli.read_issue(issue)

	return read.kind === 'state' && has_label_name(read.state.labels, NEEDS_DECISION_LABEL)
}

const lane_parked = { is_parked }

export { lane_parked }
