import { describe, expect, it } from 'vitest'
import { run_board_option, type OptionSpec } from './run-board-option'

// joshuafolkken/kit#8505: a board setting named by its flag, else by its environment variable.

const SPEC: OptionSpec<'small' | 'large'> = {
	flag: '--size',
	env: 'BOARD_SIZE',
	noun: 'size',
	names: ['small', 'large'],
}

const REFUSED = 'BOARD_SIZE=huge names no size (small, large)\n'

describe('run_board_option.choose', () => {
	it.each([
		{ argv: ['--size', 'large', '--once'], env: {}, name: 'large', rest: ['--once'] },
		{ argv: ['--size', 'large'], env: { BOARD_SIZE: 'small' }, name: 'large', rest: [] },
		{ argv: ['--once'], env: { BOARD_SIZE: 'small' }, name: 'small', rest: ['--once'] },
		{ argv: [], env: { BOARD_SIZE: '' }, name: undefined, rest: [] },
		{ argv: [], env: {}, name: undefined, rest: [] },
	])('takes $name from $argv and $env', ({ argv, env, name, rest }) => {
		expect(run_board_option.choose(argv, env, SPEC)).toStrictEqual({ name, argv: rest })
	})

	it.each([
		{ argv: ['--size', 'huge'], env: {} },
		{ argv: ['--size'], env: { BOARD_SIZE: 'small' } },
		{ argv: [], env: { BOARD_SIZE: 'huge' } },
	])('refuses a name the setting does not have in $argv and $env', ({ argv, env }) => {
		expect(run_board_option.choose(argv, env, SPEC)).toBeUndefined()
	})
})

// joshuafolkken/kit#8917: an alias is read as the name it stands for where the option is parsed.
describe('run_board_option.choose an alias', () => {
	const ALIASED: OptionSpec<'small' | 'large'> = {
		...SPEC,
		aliases: new Map([['big', 'large']]),
	}

	it.each([
		{ argv: ['--size', 'big'], env: {} },
		{ argv: [], env: { BOARD_SIZE: 'big' } },
	])('reads big as large from $argv and $env', ({ argv, env }) => {
		expect(run_board_option.choose(argv, env, ALIASED)).toStrictEqual({ name: 'large', argv: [] })
	})

	it('refuses an alias the spec does not hold, and names only the names', () => {
		expect(run_board_option.choose(['--size', 'big'], {}, SPEC)).toBeUndefined()
		expect(run_board_option.refusal([], { BOARD_SIZE: 'huge' }, ALIASED)).toBe(REFUSED)
	})
})

describe('run_board_option.refusal', () => {
	it('names the variable and the names it may take where the variable gave the name', () => {
		expect(run_board_option.refusal([], { BOARD_SIZE: 'huge' }, SPEC)).toBe(REFUSED)
	})

	it('says nothing more where the flag gave the name', () => {
		expect(run_board_option.refusal(['--size', 'huge'], { BOARD_SIZE: 'huge' }, SPEC)).toBe('')
	})
})

// joshuafolkken/kit#8915: a spec with no variable is set by its flag alone.
describe('run_board_option.choose with no variable', () => {
	const FLAG_ONLY: OptionSpec<'small' | 'large'> = { ...SPEC, env: undefined }

	it('reads no environment, so only the flag names it', () => {
		const environment = { BOARD_SIZE: 'large' }

		expect(run_board_option.choose([], environment, FLAG_ONLY)).toStrictEqual({
			name: undefined,
			argv: [],
		})
		expect(run_board_option.choose(['--size', 'small'], environment, FLAG_ONLY)).toStrictEqual({
			name: 'small',
			argv: [],
		})
		expect(run_board_option.refusal([], environment, FLAG_ONLY)).toBe('')
	})
})
