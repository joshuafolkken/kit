import { describe, expect, it } from 'vitest'
import { context_cut_payback } from './context-cut-payback'
import { cost_cli } from './cost-cli'
import { cost_cli_fixture } from './cost-cli-fixture'

// joshuafolkken/kit#5341: on the Anthropic transcript path — every Claude lane child and backlogrun
// parent — the `--cut` limit is priced at the model of the session's newest request, read off the
// transcript itself rather than handed in by a mocked measurement.
const { CWD, SESSION_A, priced_line, write_session, stdout } = cost_cli_fixture

cost_cli_fixture.capture_console()

const ANTHROPIC_ENV = { CLAUDE_CODE_SESSION_ID: SESSION_A }
const OPUS = 'claude-opus-5-5'
const STANDARD = 'claude-opus-5'
const OPUS_THRESHOLD = context_cut_payback.break_even_context(OPUS)
const STANDARD_THRESHOLD = context_cut_payback.break_even_context(STANDARD)

describe('cost_cli.run --cut on an Anthropic transcript', () => {
	it.each([
		[OPUS_THRESHOLD, 'under'],
		[OPUS_THRESHOLD + 1, 'over'],
	])('prices %i tokens on Opus 5.5 at its own break-even as %s', (tokens, verdict) => {
		write_session(SESSION_A, [priced_line('r1', OPUS, tokens)])

		expect(cost_cli.run(['--cut'], CWD, ANTHROPIC_ENV)).toBe(0)
		expect(stdout().trim()).toBe(verdict)
	})

	it("prices a session that switched models at its newest request's model", () => {
		const tokens = STANDARD_THRESHOLD + 1

		write_session(SESSION_A, [priced_line('r1', STANDARD, 1), priced_line('r2', OPUS, tokens)])

		expect(cost_cli.session_figures(CWD, ANTHROPIC_ENV)).toStrictEqual({
			verdict: 'under',
			cost: tokens,
			threshold: OPUS_THRESHOLD,
		})
	})

	it('prices a switch back to the standard rate at the standard break-even', () => {
		const tokens = STANDARD_THRESHOLD + 1

		write_session(SESSION_A, [priced_line('r1', OPUS, 1), priced_line('r2', STANDARD, tokens)])

		expect(cost_cli.session_figures(CWD, ANTHROPIC_ENV)).toStrictEqual({
			verdict: 'over',
			cost: tokens,
			threshold: STANDARD_THRESHOLD,
		})
	})
})
