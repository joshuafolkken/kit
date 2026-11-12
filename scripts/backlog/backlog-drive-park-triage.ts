import { epic_triage } from '#scripts/epic/epic-triage'
import { process_identity } from '#scripts/josh/process-identity'
import type { DriveState, PassResult } from './backlog-drive'

// **A collected park owes the parent triage — but only after the pass has offered and opened what a
// free lane can take**, so the seat is not left empty while the judgment session runs
// (joshuafolkken/kit#6871). The judge, the drain and the retrospective all wait for that triage.
//
// **The judgment session runs beside the driver, never in its place** (joshuafolkken/kit#7120): the
// supervisor launches it without handing the carry record over and names its process on the resume
// line (`triage_pid`). While that process lives the driver goes on collecting and filling lanes, holds
// back every answer the triage could change, and keeps a park it collects meanwhile owed — the next
// triage is handed back once the session has ended.

const TRIAGE_TOKEN = epic_triage.TRIAGE_VERDICT

// A live pid whose start time differs is a reissued pid, not the session; a platform that cannot read
// the start time falls back to liveness (`process_identity.is_same_process`).
function is_beside(state: DriveState): boolean {
	return process_identity.is_same_process(state.triage_pid, state.triage_start) !== false
}

// The state with a triage session that has ended dropped, so the resume line stops naming it.
function settled(state: DriveState): DriveState {
	return state.triage_pid === undefined || is_beside(state)
		? state
		: { ...state, triage_pid: undefined, triage_start: undefined }
}

// Owed now: a session still at work beside the driver defers the owed triage until it has ended.
function is_owed(state: DriveState): boolean {
	return state.is_triage_owed === true && !state.is_stopping && !is_beside(state)
}

// A pass that went on ends with `triage` when one is owed and no triage session runs beside it; a pass
// that already ended keeps that end.
function triaged(result: PassResult, is_triage_owed: boolean): PassResult {
	if (!is_triage_owed || result.kind === 'end' || is_beside(result.state)) return result

	return {
		kind: 'end',
		end: { reason: TRIAGE_TOKEN, token: TRIAGE_TOKEN, issue: undefined },
		state: { ...result.state, is_triage_owed: false },
	}
}

// What a park owes before any answer but `run` is read: the `triage` end, a held pass while a session
// triages beside the driver, or `undefined` when neither applies.
function hand_back(state: DriveState): PassResult | undefined {
	if (is_beside(state) && !state.is_stopping) return { kind: 'continue', state }

	return is_owed(state) ? triaged({ kind: 'continue', state }, true) : undefined
}

const backlog_drive_park_triage = { is_owed, triaged, hand_back, settled }

export { backlog_drive_park_triage }
