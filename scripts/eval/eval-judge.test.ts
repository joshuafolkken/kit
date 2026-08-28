import { describe, expect, it } from 'vitest'
import { eval_judge } from './eval-judge'
import {
	tool_call as call,
	CUT_SHORT_SESSION,
	HEALTHY_SESSION,
	scenario_with,
} from './eval-scenario-fixture'

const BECAUSE = 'the rule this scenario measures'
const GH_ISSUE_CREATE = 'gh issue create'
const GH_ISSUE_VIEW = 'gh issue view 1'

describe('eval_judge.judge — should_call', () => {
	it('passes when the call was made', () => {
		const scenario = scenario_with({ should_call: [{ tool: 'Read', because: BECAUSE }] })

		expect(eval_judge.judge(scenario, [call('Read')], HEALTHY_SESSION).is_pass).toBe(true)
	})

	it('fails when it was not, and says why the call was the evidence', () => {
		const scenario = scenario_with({ should_call: [{ tool: 'Read', because: BECAUSE }] })
		const verdict = eval_judge.judge(scenario, [call('Bash')], HEALTHY_SESSION)

		expect(verdict.is_pass).toBe(false)
		expect(verdict.failures[0]?.because).toBe(BECAUSE)
	})

	// Matching the tool name alone cannot tell `gh issue create` from `gh issue view`, and the rules
	// these scenarios measure are almost always about one particular command.
	it('matches on the input, not only the tool name', () => {
		const scenario = scenario_with({
			should_call: [{ tool: 'Bash', input_matches: GH_ISSUE_CREATE, because: BECAUSE }],
		})

		expect(
			eval_judge.judge(scenario, [call('Bash', { command: GH_ISSUE_VIEW })], HEALTHY_SESSION)
				.is_pass,
		).toBe(false)
		expect(
			eval_judge.judge(
				scenario,
				[call('Bash', { command: `${GH_ISSUE_CREATE} -t x` })],
				HEALTHY_SESSION,
			).is_pass,
		).toBe(true)
	})
})

describe('eval_judge.judge — should_not_call', () => {
	it('passes on a run that never made the call', () => {
		const scenario = scenario_with({ should_not_call: [{ tool: 'Edit', because: BECAUSE }] })

		expect(eval_judge.judge(scenario, [call('Read')], HEALTHY_SESSION).is_pass).toBe(true)
	})

	it('fails on a run that did', () => {
		const scenario = scenario_with({ should_not_call: [{ tool: 'Edit', because: BECAUSE }] })

		expect(eval_judge.judge(scenario, [call('Read'), call('Edit')], HEALTHY_SESSION).is_pass).toBe(
			false,
		)
	})

	// An empty transcript satisfies every prohibition for free, which is not the rule holding — it is
	// the session never having run. The suite hit exactly this while it was being built: an unclosed
	// stdin pipe stalled the CLI, every transcript came back empty, and three prohibition scenarios
	// reported green while measuring nothing.
	it('does not pass an empty run', () => {
		const scenario = scenario_with({ should_not_call: [{ tool: 'Edit', because: BECAUSE }] })

		expect(eval_judge.judge(scenario, [], HEALTHY_SESSION).is_pass).toBe(false)
	})

	it('reports an empty run as inconclusive rather than as a violation', () => {
		const scenario = scenario_with({ should_not_call: [{ tool: 'Edit', because: BECAUSE }] })
		const verdict = eval_judge.judge(scenario, [], HEALTHY_SESSION)

		expect(verdict.is_inconclusive).toBe(true)
		expect(verdict.failures).toStrictEqual([])
	})

	// A single call is enough to show the session ran, which is all the inconclusive check asks.
	it('judges a run that called something, even something unrelated', () => {
		const scenario = scenario_with({ should_not_call: [{ tool: 'Edit', because: BECAUSE }] })
		const verdict = eval_judge.judge(scenario, [call('Read')], HEALTHY_SESSION)

		expect(verdict.is_inconclusive).toBe(false)
		expect(verdict.is_pass).toBe(true)
	})

	// A requirement-only scenario is inconclusive on an empty run too. Reading it as a conclusive miss
	// would be the same mistake in the other direction: the agent did not decline to call the tool, it
	// never got a session in which to call anything.
	it('is inconclusive on an empty run even when the scenario only requires calls', () => {
		const scenario = scenario_with({ should_call: [{ tool: 'Read', because: BECAUSE }] })
		const verdict = eval_judge.judge(scenario, [], HEALTHY_SESSION)

		expect(verdict.is_inconclusive).toBe(true)
		expect(verdict.is_pass).toBe(false)
	})
})

describe('eval_judge.judge — should_call_in_order', () => {
	const ORDERED = {
		should_call_in_order: [{ before: { tool: 'Read' }, after: { tool: 'Bash' }, because: BECAUSE }],
	}

	it('passes when the first call comes first', () => {
		expect(
			eval_judge.judge(scenario_with(ORDERED), [call('Read'), call('Bash')], HEALTHY_SESSION)
				.is_pass,
		).toBe(true)
	})

	it('fails when the order is reversed', () => {
		expect(
			eval_judge.judge(scenario_with(ORDERED), [call('Bash'), call('Read')], HEALTHY_SESSION)
				.is_pass,
		).toBe(false)
	})

	// A run missing one side has already failed its own `should_call`; reporting the same gap again
	// as an ordering failure buries the one message that names the rule.
	it.each([
		['neither call', []],
		['only the earlier call', [call('Read')]],
		['only the later call', [call('Bash')]],
	])('reports no ordering failure for a run with %s', (_label, calls) => {
		expect(eval_judge.judge(scenario_with(ORDERED), calls, HEALTHY_SESSION).failures).toStrictEqual(
			[],
		)
	})
})

// Matching by tool name alone read an unrelated earlier call as satisfying the pair, which is what
// makes this its own suite rather than one more case above.
describe('eval_judge.judge — should_call_in_order matches the input too', () => {
	it('is not satisfied by an unrelated earlier call of the same tool', () => {
		const scenario = scenario_with({
			should_call_in_order: [
				{
					before: { tool: 'Read', input_matches: 'SKILL' },
					after: { tool: 'Bash' },
					because: BECAUSE,
				},
			],
		})
		const calls = [
			call('Read', { file_path: '/s/CLAUDE.md' }),
			call('Bash', { command: GH_ISSUE_VIEW }),
			call('Read', { file_path: '/s/SKILL.md' }),
		]

		expect(eval_judge.judge(scenario, calls, HEALTHY_SESSION).is_pass).toBe(false)
	})
})

describe('eval_judge.judge — verdict', () => {
	it('reports every broken expectation, not only the first', () => {
		const scenario = scenario_with({
			should_call: [{ tool: 'Read', because: BECAUSE }],
			should_not_call: [{ tool: 'Edit', because: BECAUSE }],
		})

		expect(eval_judge.judge(scenario, [call('Edit')], HEALTHY_SESSION).failures).toHaveLength(2)
	})

	it('carries the calls, so a failure can be read without the transcript', () => {
		const scenario = scenario_with({ should_call: [{ tool: 'Read', because: BECAUSE }] })

		expect(eval_judge.judge(scenario, [call('Bash')], HEALTHY_SESSION).calls).toHaveLength(1)
	})
})

// An API drop mid-scenario is the common way a session dies, and it leaves a transcript full of real
// calls. Throwing all of that away would make the suite unusable on a flaky connection; keeping all
// of it would report "never called it" for a run that had not got there yet.
describe('eval_judge.judge — a session that died part way', () => {
	it('still reports a forbidden call it actually made', () => {
		const scenario = scenario_with({ should_not_call: [{ tool: 'Edit', because: BECAUSE }] })
		const verdict = eval_judge.judge(scenario, [call('Edit')], CUT_SHORT_SESSION)

		expect(verdict.is_inconclusive).toBe(false)
		expect(verdict.is_pass).toBe(false)
	})

	it('throws out a missing required call, which the run may not have reached', () => {
		const scenario = scenario_with({ should_call: [{ tool: 'Read', because: BECAUSE }] })
		const verdict = eval_judge.judge(scenario, [call('Bash')], CUT_SHORT_SESSION)

		expect(verdict.is_inconclusive).toBe(true)
		expect(verdict.note).toContain('part way')
	})

	// The tempting case: nothing forbidden was called, so this looks like the rule holding. It is not —
	// the session died, and a prohibition it never reached is not a prohibition it respected. Reading
	// this as a pass is the false green the whole inconclusive verdict exists to prevent.
	it('does not pass a prohibition the session may have died before reaching', () => {
		const scenario = scenario_with({ should_not_call: [{ tool: 'Edit', because: BECAUSE }] })
		const verdict = eval_judge.judge(scenario, [call('Read')], CUT_SHORT_SESSION)

		expect(verdict.is_pass).toBe(false)
		expect(verdict.is_inconclusive).toBe(true)
	})
})

const NOTE_SCENARIO = scenario_with({ should_call: [{ tool: 'Read', because: BECAUSE }] })
const INIT_LINE = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' })
const LOW_BALANCE = 'Credit balance is too low'
const ERROR_LINE = JSON.stringify({
	type: 'result',
	is_error: true,
	subtype: 'error_during_execution',
	result: LOW_BALANCE,
})
const EXITED_ONE_NO_START = 'session exited 1 without starting'
const NO_TRANSCRIPT = { exit_code: 1, stderr: '', transcript: '' }
const WITHOUT_STARTING = 'without starting'
const NOT_LOGGED_IN = 'not logged in'

function note_for(session: Parameters<typeof eval_judge.judge>[2]): string {
	return eval_judge.judge(NOTE_SCENARIO, [], session).note ?? ''
}

// joshuafolkken/kit#1001: across joshuafolkken/kit#908 the suite reported four scenarios in a row as
// `session exited 1 without running`, with nothing after the code — every one of them had an empty
// stderr, so the sentence was the whole diagnosis. Two facts were available and unused: whether the
// stream announced its `init` event, and the `result` event the CLI writes when a run fails.
describe('eval_judge — why a session produced no measurement', () => {
	it('says a session never started when the stream announced nothing', () => {
		expect(note_for(NO_TRANSCRIPT)).toContain(WITHOUT_STARTING)
	})

	// The distinction the Issue asked for: an expired login and an API drop after the session was
	// under way both leave no tool calls, and used to print the same sentence.
	it('says a session started but called nothing when it announced itself first', () => {
		const note = note_for({ exit_code: 1, stderr: '', transcript: INIT_LINE })

		expect(note).toContain('after starting, before calling any tool')
		expect(note).not.toContain(WITHOUT_STARTING)
	})

	// execa reports **no** exit code for a signal-terminated process, so a timeout arrives as the
	// spawn-failure sentinel rather than as 143 — which is why the timeout is named from its own flag
	// and not from the number (joshuafolkken/kit#1001).
	it('names a timeout rather than the sentinel exit code it arrives with', () => {
		const note = note_for({ exit_code: -1, stderr: '', transcript: '', is_timed_out: true })

		expect(note).toContain('timed out')
		expect(note).not.toContain('exited')
	})

	// A kill that is not the timeout — an OOM killer, a harness watchdog — used to print the same
	// sentence as a `claude` that never started, because both arrive with no exit code.
	it('names the signal when something else killed it', () => {
		const note = note_for({ exit_code: -1, stderr: '', transcript: '', signal: 'SIGKILL' })

		expect(note).toContain('killed by SIGKILL')
		expect(note).not.toContain('exited')
	})

	it('still reports the exit code when the run was not timed out', () => {
		expect(note_for(NO_TRANSCRIPT)).toContain('exited 1')
	})
})

describe('eval_judge — the reason, from whichever source has one', () => {
	it('prefers stderr, the process own last word', () => {
		expect(note_for({ exit_code: 1, stderr: NOT_LOGGED_IN, transcript: ERROR_LINE })).toContain(
			NOT_LOGGED_IN,
		)
	})

	// The case that actually occurred: stderr silent, the reason sitting unread in the stream.
	it('falls back to the stream result event when stderr is silent', () => {
		expect(note_for({ exit_code: 1, stderr: '', transcript: ERROR_LINE })).toContain(LOW_BALANCE)
	})

	it('says only what it knows when neither source has a reason', () => {
		expect(note_for(NO_TRANSCRIPT)).toBe(EXITED_ONE_NO_START)
	})
})
