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
