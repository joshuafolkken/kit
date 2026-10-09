// The mark every agent session kit launches itself carries — a lane child, a ship reviewer, a woken
// `run:wake` session.
//
// **Those sessions run under `claude -p`, and nobody reads their replies.** Their output goes to a
// stream-json log, and the only reader of the final text is the exit record's failure reason. So the
// stop rules that correct how a reply is written — the issue citation, the session language — refused
// replies no person would ever see, and each refusal cost a model turn: across one baseline run, 107
// of them in children and wake sessions.
//
// **It is set at the one place agent sessions are launched, never read from the prompt.** Every launch
// that passes an agent profile composes its environment in `agent_launch_environment.build`, so the
// mark is exactly "kit started this agent". A person's own session is never spawned there, so it never
// carries the mark; a process the headless session starts inherits it, and is headless too.
const KEY = 'JOSH_AGENT_HEADLESS'
const VALUE = '1'

type EnvironmentSource = Readonly<Record<string, string | undefined>>

function environment(): Record<string, string> {
	return { [KEY]: VALUE }
}

function is_headless(source: EnvironmentSource = process.env): boolean {
	return source[KEY] === VALUE
}

const agent_headless = { KEY, environment, is_headless }

export { agent_headless }
