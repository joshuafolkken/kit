import { describe, expect, it } from 'vitest'
import { backlogrun_args } from './backlogrun-args'

// joshuafolkken/kit#3437: `josh backlogrun`'s arguments reach the agent as the `backlogrun` invocation the
// carry grammar reads, and `--agent` picks the agent it is started in.

const { parse } = backlogrun_args

describe('backlogrun_args.parse', () => {
	it('starts a bare backlogrun in Claude by default', () => {
		expect(parse([])).toStrictEqual({
			kind: 'args',
			args: { provider: 'anthropic', invocation: 'backlogrun', issues: [] },
		})
	})

	it('picks Codex with --agent codex wherever the flag sits', () => {
		expect(parse(['#3437', '--agent', 'codex', '--only'])).toMatchObject({
			kind: 'args',
			args: { provider: 'openai', issues: [3437] },
		})
	})

	it('hands the named issues and flags through as the invocation', () => {
		const parsed = parse(['#3437', '#3438', '--only'])

		expect(parsed).toMatchObject({
			kind: 'args',
			args: { invocation: 'backlogrun #3437 #3438 --only', issues: [3437, 3438] },
		})
	})

	it('reads a bare number in the named list as an issue', () => {
		expect(parse(['3437', '--only'])).toMatchObject({
			kind: 'args',
			args: { invocation: 'backlogrun #3437 --only', issues: [3437] },
		})
	})
})

describe('backlogrun_args.parse flags', () => {
	it('leaves a number that is a flag value alone', () => {
		expect(parse(['--max', '3'])).toMatchObject({
			kind: 'args',
			args: { invocation: 'backlogrun --max 3', issues: [] },
		})
	})

	it.each([
		{ argv: ['--agent', 'gemini'] },
		{ argv: ['--agent'] },
		{ argv: ['--agent', 'constructor'] },
		{ argv: ['--agent', 'openai'] },
		{ argv: ['--agent', 'anthropic'] },
		{ argv: ['--bogus'] },
		{ argv: ['--agent', 'claude', '--agent', 'codex'] },
		// joshuafolkken/kit#3597: issue `0` and a leading zero are not issue numbers, bare or prefixed.
		{ argv: ['0'] },
		{ argv: ['#0'] },
		{ argv: ['05'] },
		{ argv: ['3437', '0'] },
	])('refuses $argv with the usage', ({ argv }) => {
		expect(parse(argv)).toStrictEqual({ kind: 'refused' })
	})
})

describe('backlogrun_args.parse configured provider', () => {
	it.each([
		{ value: undefined, provider: 'anthropic' },
		{ value: '', provider: 'anthropic' },
		{ value: '  ', provider: 'anthropic' },
		{ value: 'anthropic', provider: 'anthropic' },
		{ value: 'openai', provider: 'openai' },
		{ value: ' openai ', provider: 'openai' },
	])('selects $provider for $value and keeps the invocation', ({ value, provider }) => {
		expect(parse(['5403', '--only'], { JOSH_AGENT_PROVIDER: value })).toStrictEqual({
			kind: 'args',
			args: { provider, invocation: 'backlogrun #5403 --only', issues: [5403] },
		})
	})
})

describe('backlogrun_args.parse provider overrides and refusals', () => {
	it.each(['codex', 'claude', 'constructor', 'OPENAI'])(
		'refuses invalid provider %s with a reason',
		(value) => {
			expect(parse([], { JOSH_AGENT_PROVIDER: value })).toStrictEqual({
				kind: 'refused',
				note: `JOSH_AGENT_PROVIDER=${value} is not an allowed provider, so the agent was not started`,
			})
		},
	)

	it.each([
		{ agent: 'claude', value: 'openai', provider: 'anthropic' },
		{ agent: 'codex', value: 'anthropic', provider: 'openai' },
		{ agent: 'codex', value: 'invalid', provider: 'openai' },
	])('lets explicit $agent override $value', ({ agent, value, provider }) => {
		expect(parse(['--agent', agent], { JOSH_AGENT_PROVIDER: value })).toMatchObject({
			kind: 'args',
			args: { provider },
		})
	})

	it.each(['stop', 'restart'])('keeps --%s independent of an invalid default', (kind) => {
		expect(parse([`--${kind}`], { JOSH_AGENT_PROVIDER: 'invalid' })).toStrictEqual({ kind })
	})

	it('does not use the invoking session to select the new run', () => {
		expect(
			parse([], { CODEX_THREAD_ID: 'session', JOSH_AGENT_PROVIDER: 'anthropic' }),
		).toMatchObject({
			kind: 'args',
			args: { provider: 'anthropic' },
		})
	})
})

// joshuafolkken/kit#3708: `--stop` stops the run, so it is read only where it stands alone.
describe('backlogrun_args.parse --stop', () => {
	it('reads a lone --stop as the stop', () => {
		expect(parse(['--stop'])).toStrictEqual({ kind: 'stop' })
	})

	it.each([
		{ argv: ['3437', '--stop'] },
		{ argv: ['--stop', '#3437'] },
		{ argv: ['--stop', '--only'] },
		{ argv: ['--max', '3', '--stop'] },
		{ argv: ['--stop', '--idle', '30'] },
		{ argv: ['--stop', '--agent', 'codex'] },
		{ argv: ['--stop', '--stop'] },
	])('refuses $argv, so a mistyped start stops nothing', ({ argv }) => {
		expect(parse(argv)).toStrictEqual({ kind: 'refused' })
	})
})

// joshuafolkken/kit#4154: `--restart` replaces the run's processes, so it too stands alone.
describe('backlogrun_args.parse --restart', () => {
	it('reads a lone --restart as the restart', () => {
		expect(parse(['--restart'])).toStrictEqual({ kind: 'restart' })
	})

	it.each([
		{ argv: ['3437', '--restart'] },
		{ argv: ['--restart', '--only'] },
		{ argv: ['--restart', '--agent', 'codex'] },
		{ argv: ['--restart', '--stop'] },
		{ argv: ['--restart', '--restart'] },
	])('refuses $argv, so a mistyped restart stops nothing', ({ argv }) => {
		expect(parse(argv)).toStrictEqual({ kind: 'refused' })
	})

	it.each([{ argv: ['constructor'] }, { argv: ['toString'] }])(
		'does not read $argv as a lone flag inherited from Object',
		({ argv }) => {
			expect(parse(argv)).toStrictEqual({ kind: 'refused' })
		},
	)
})
