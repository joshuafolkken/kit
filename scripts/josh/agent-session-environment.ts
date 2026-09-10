// The environment variables that name the **parent** agent session, and which a child session must
// not inherit.
//
// It lived inside `scripts/eval/eval-session.ts` until `josh run:wake` became a second launcher of a
// headless session (joshuafolkken/kit#1719). Two copies of this list is the clone `CLAUDE.md`
// prohibits, and this is the shape of clone that fails silently: the copy that drifts does not throw
// or lint — the child dials the parent's private socket, is refused, and the session dies as
// `API Error: Unable to connect to API (ConnectionRefused)` with nothing anywhere naming the cause.
//
// `CLAUDE_CODE_MESSAGING_SOCKET` is a UNIX socket only the parent listens on,
// `CLAUDE_CODE_MESSAGING_TOKEN` is that socket's credential, and the two session identifiers claim
// the parent's session as the child's own. Measured under joshuafolkken/kit#1158: removing them
// restored 5/5 held in 54 seconds, and lowering the concurrency — the suspected cause before this one
// was found — made it worse.
const PARENT_SESSION_KEYS: ReadonlyArray<string> = [
	'CLAUDE_CODE_MESSAGING_SOCKET',
	'CLAUDE_CODE_MESSAGING_TOKEN',
	'CLAUDE_CODE_SESSION_ID',
	'CLAUDE_CODE_CHILD_SESSION',
]

// **`undefined` rather than `''`**, because an empty socket path is still a socket path to whatever
// reads it. Node's spawn omits an environment key whose value is `undefined`, which is the only way
// to hand the child an environment that does not have the variable at all — and both callers spread
// this over an inherited environment, so anything less than absent leaves the variable set.
function removed_environment(): Record<string, undefined> {
	return Object.fromEntries(PARENT_SESSION_KEYS.map((key) => [key, undefined]))
}

const agent_session_environment = {
	PARENT_SESSION_KEYS,
	removed_environment,
}

export { agent_session_environment }
