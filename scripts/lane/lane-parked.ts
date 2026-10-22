import { has_parked_label } from '#scripts/issue/issue-labels'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'

// Whether an issue is parked for a person — any park label (`PARKED_LABELS`) — read live, so a session a
// lane's broker would start for it is refused once the run has parked it (joshuafolkken/kit#3878).
//
// **An issue whose state cannot be read is not parked**: the read gates every brokered review, so
// reading an outage as a park would fail every review in flight for as long as GitHub is away.

async function is_parked(issue: string): Promise<boolean> {
	const read = await issue_state_cli.read_issue(issue)

	return read.kind === 'state' && has_parked_label(read.state.labels)
}

const lane_parked = { is_parked }

export { lane_parked }
