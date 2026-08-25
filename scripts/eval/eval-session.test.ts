import { describe, expect, it } from 'vitest'
import { scenario_with } from './eval-scenario-fixture'
import { eval_session } from './eval-session'

// The argument list is asserted rather than the spawn: every flag here is load-bearing, and two of
// them fail in ways that look like the agent misbehaving rather than the harness being wrong.
describe('eval_session.session_arguments', () => {
	const flags = eval_session.session_arguments(scenario_with(), 'sonnet')

	// `-p` refuses `--output-format stream-json` unless `--verbose` is also passed, and the stream is
	// the only place the tool calls appear — without it a run exits 1 and every scenario reads red.
	it.each(['-p', '--output-format', 'stream-json', '--verbose'])('passes %s', (flag) => {
		expect(flags).toContain(flag)
	})

	it('passes the prompt the scenario declares', () => {
		expect(
			eval_session.session_arguments(scenario_with({ prompt: 'ask this' }), 'sonnet'),
		).toContain('ask this')
	})

	it('passes the turn limit as the scenario set it', () => {
		const bounded = eval_session.session_arguments(scenario_with({ max_turns: 3 }), 'sonnet')

		expect(bounded[bounded.indexOf('--max-turns') + 1]).toBe('3')
	})

	it('passes the model the runner chose', () => {
		const arguments_list = eval_session.session_arguments(scenario_with(), 'opus')

		expect(arguments_list[arguments_list.indexOf('--model') + 1]).toBe('opus')
	})

	// Unattended is the point: a scenario measuring whether the agent reaches for a forbidden tool
	// has to let it try. That is only safe because the cwd is a throwaway sandbox.
	it('runs unattended', () => {
		expect(flags).toContain('--dangerously-skip-permissions')
	})
})

// The blast radius, asserted. `--dangerously-skip-permissions` lets a scenario measure whether the
// agent reaches for a forbidden tool, and `upstream-interrupt` puts it in front of the one rule that
// says to file a GitHub Issue without asking — so the credentials that would let that land are taken
// away, while the call itself stays observable in the transcript.
// A stand-in path, never created: this suite asks what the environment says, not what is on disk.
const SANDBOX_PATH = '/sandbox-probe'

describe('eval_session.session_environment', () => {
	const environment = eval_session.session_environment(SANDBOX_PATH)

	it.each(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'])(
		'clears %s',
		(key) => {
			expect(environment[key]).toBe('')
		},
	)

	// `gh` reads its login from a config directory, not only from the token variables; pointing it at
	// one inside the sandbox leaves it unauthenticated whatever the developer's own login is.
	it('points gh at a config directory inside the sandbox', () => {
		expect(environment['GH_CONFIG_DIR']).toContain(SANDBOX_PATH)
	})
})
