import { describe, expect, it } from 'vitest'
import { run_board_option, type OptionSpec } from './run-board-option'

// joshuafolkken/kit#8505: a board setting named by its flag, else by its environment variable.

const SPEC: OptionSpec<'small' | 'large'> = {
	flag: '--size',
	env: 'BOARD_SIZE',
	noun: 'size',
	names: ['small', 'large'],
}

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

describe('run_board_option.refusal', () => {
	it('names the variable and the names it may take where the variable gave the name', () => {
		expect(run_board_option.refusal([], { BOARD_SIZE: 'huge' }, SPEC)).toBe(
			'BOARD_SIZE=huge names no size (small, large)\n',
		)
	})

	it('says nothing more where the flag gave the name', () => {
		expect(run_board_option.refusal(['--size', 'huge'], { BOARD_SIZE: 'huge' }, SPEC)).toBe('')
	})
})
