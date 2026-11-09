import { epic_triage } from '#scripts/epic/epic-triage'
import type { DriveState, PassResult } from './backlog-drive'

// **A collected park owes the parent triage — but only after the pass has offered and opened what a
// free lane can take**, so the seat is not left empty while the judgment session runs
// (joshuafolkken/kit#6871). The judge, the drain and the retrospective all wait for that triage.

const TRIAGE_TOKEN = epic_triage.TRIAGE_VERDICT

function is_owed(state: DriveState): boolean {
	return state.is_triage_owed === true && !state.is_stopping
}

// A pass that went on ends with `triage` when one is owed; a pass that already ended keeps that end.
function triaged(result: PassResult, is_triage_owed: boolean): PassResult {
	if (!is_triage_owed || result.kind === 'end') return result

	return {
		kind: 'end',
		end: { reason: TRIAGE_TOKEN, token: TRIAGE_TOKEN, issue: undefined },
		state: { ...result.state, is_triage_owed: false },
	}
}

// The `triage` end a park owes before any answer but `run` is read, or `undefined` when none is owed.
function hand_back(state: DriveState): PassResult | undefined {
	return is_owed(state) ? triaged({ kind: 'continue', state }, true) : undefined
}

const backlog_drive_park_triage = { is_owed, triaged, hand_back }

export { backlog_drive_park_triage }
