import type { SessionOutcome } from './eval-judge'
import { eval_scenario, type Scenario } from './eval-scenario'
import type { ToolCall } from './eval-transcript'

// Four suites need the same two things: a scenario built from the minimum a scenario needs plus the
// one field under test, and a tool call shaped the way the transcript parser produces them. Declared
// once here, so the minimum a scenario needs is one definition rather than four that drift apart.

const MINIMAL_SCENARIO = { name: 'probe', rule: 'a rule', prompt: 'a prompt' }
const FIXTURE_FILE_NAME = 'probe.json'

function scenario_with(fields: Record<string, unknown> = {}): Scenario {
	const declaration = JSON.stringify({ ...MINIMAL_SCENARIO, ...fields })

	return eval_scenario.parse_scenario(FIXTURE_FILE_NAME, declaration)
}

// The input is JSON-encoded because that is what the parser hands the judge — a scenario matches on
// the encoded form, so a fixture that stored the object would test a shape nothing produces.
function tool_call(name: string, input: Record<string, unknown> = {}): ToolCall {
	return { name, input: JSON.stringify(input) }
}

// A session that finished cleanly. Passed by every suite that is asking about a rule rather than
// about the harness, so those tests are not silently also asserting the session-level guard.
const HEALTHY_SESSION: SessionOutcome = { exit_code: 0, stderr: '', transcript: '' }

// A session that ran and then died — the API dropping mid-scenario is the common one.
const CUT_SHORT_SESSION: SessionOutcome = { exit_code: 1, stderr: '', transcript: '' }

export {
	CUT_SHORT_SESSION,
	FIXTURE_FILE_NAME,
	HEALTHY_SESSION,
	MINIMAL_SCENARIO,
	scenario_with,
	tool_call,
}
