import { hook_decision } from '#scripts/josh/hook-decision'

// Whether a run owes its end-of-run retrospective, single-sourced so `run:step` and `backlog:drive`
// never disagree on it: a drive that read "owed" where `run:step` read "not owed" would hand back at
// every drain to a session that had nothing to run.

// The opt-in switch that gates the retrospective. It defaults off, so an unset
// variable owes no retrospective.
const RETROSPECTIVE_ENV_KEY = 'JOSH_RETROSPECTIVE'

interface RetrospectiveFacts {
	is_retrospective_enabled: boolean
	is_lane_child: boolean
	is_retrospective_done: boolean
	is_consumer: boolean
}

function is_enabled(): boolean {
	return hook_decision.is_switch_opt_in(RETROSPECTIVE_ENV_KEY)
}

// False when the switch is off, for a dispatched lane child (the batch runs one at its own end, never a
// child's), once it has run this invocation, and in a consumer checkout, where the kit-only command is
// refused. The switch is read first, so a run that has not opted in never consults the other three.
function is_owed(facts: RetrospectiveFacts): boolean {
	if (!facts.is_retrospective_enabled) return false

	return !facts.is_lane_child && !facts.is_retrospective_done && !facts.is_consumer
}

const run_retrospective = { is_enabled, is_owed }

export type { RetrospectiveFacts }
export { run_retrospective }
