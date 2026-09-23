import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { cost_transcript, type SessionFile } from './cost-transcript'

// Which transcript in a listing is the *calling* session's own (joshuafolkken/kit#2403).
//
// **The mtime was measuring another session.** `latest_own_index` took the newest non-delegated
// transcript as "the run that just finished", which is right for a report run after a run ends but
// wrong for a session asking its *own* cost while another is still writing: a `backlogrun` parent
// waiting on a lane child stops writing its own transcript, so the child's is always newer, and the
// parent's `--cut` priced the child — reading 34 real requests as none and cutting a session that
// was under budget.
//
// **Claude Code exports the running session's id, so the session can name its own file** rather than
// guess by time. When the environment names one, the selection is by id and nothing else — a newer
// transcript under any other slug is never picked. When it names none (a plain shell outside a
// session), the mtime fallback is exactly the behavior this replaces.

type Environment = Readonly<Record<string, string | undefined>>

const NOT_FOUND = -1

// The calling session's own transcript in a listing:
//   - `own` — its index, either the session the environment named or (with no name) the newest own
//     file `latest_own_index` picks;
//   - `absent` — the environment named a session whose transcript is not in the listing, which is
//     measured as "not found" rather than folded to another session's newest file.
type OwnSessionSelection = { kind: 'own'; index: number } | { kind: 'absent'; session_id: string }

// The running session's id, or `undefined` when the environment names none — an empty value counts as
// none, so `CLAUDE_CODE_SESSION_ID=` does not read as a session named the empty string.
function session_id_of(environment: Environment): string | undefined {
	const value = environment[agent_session_environment.SESSION_ID_KEY]

	return value === undefined || value === '' ? undefined : value
}

function select_own_session(
	files: ReadonlyArray<SessionFile>,
	environment: Environment,
): OwnSessionSelection {
	const session_id = session_id_of(environment)

	if (session_id === undefined) {
		return { kind: 'own', index: cost_transcript.latest_own_index(files) }
	}

	const index = files.findIndex((file) => file.session_id === session_id)

	return index === NOT_FOUND ? { kind: 'absent', session_id } : { kind: 'own', index }
}

const own_session = {
	session_id_of,
	select_own_session,
}

export type { OwnSessionSelection }
export { own_session }
