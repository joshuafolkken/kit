import { describe, expect, it } from 'vitest'
import { cli_flags } from './cli-flags'

const OPTIONS = { json: { type: 'boolean' }, repo: { type: 'string' } } as const
const ISSUE = '2902'
const REPO_FLAG = '--repo'
const REPO = 'owner/name'
const UNKNOWN_FLAG = 'an unknown flag'
const MISSING_VALUE = 'a string option with no value'
const UNDEFINED_ON = 'answers undefined on %s'

describe('cli_flags.parse_or_undefined', () => {
	it('answers what parseArgs answers on a well-formed invocation', () => {
		const parsed = cli_flags.parse_or_undefined({
			args: [ISSUE, '--json', REPO_FLAG, REPO],
			options: OPTIONS,
			allowPositionals: true,
		})

		expect(parsed?.values).toEqual({ json: true, repo: REPO })
		expect(parsed?.positionals).toEqual([ISSUE])
	})

	it.each([
		[UNKNOWN_FLAG, ['--nope']],
		[MISSING_VALUE, [REPO_FLAG]],
		['a positional the config does not allow', [ISSUE]],
	])('answers undefined on %s rather than throwing', (_label, args) => {
		expect(cli_flags.parse_or_undefined({ args, options: OPTIONS, strict: true })).toBeUndefined()
	})
})

describe('cli_flags.values_of', () => {
	it('answers the flag values of a well-formed invocation', () => {
		expect(cli_flags.values_of(['--json', REPO_FLAG, REPO], OPTIONS)).toEqual({
			json: true,
			repo: REPO,
		})
	})

	it.each([
		[UNKNOWN_FLAG, ['--nope']],
		[MISSING_VALUE, [REPO_FLAG]],
		['a positional', [ISSUE]],
	])(UNDEFINED_ON, (_label, argv) => {
		expect(cli_flags.values_of(argv, OPTIONS)).toBeUndefined()
	})
})

describe('cli_flags.arguments_of', () => {
	it('answers the flag values and the positionals', () => {
		const parsed = cli_flags.arguments_of([ISSUE, '--json'], OPTIONS)

		expect(parsed?.values).toEqual({ json: true })
		expect(parsed?.positionals).toEqual([ISSUE])
	})

	it.each([
		[UNKNOWN_FLAG, [ISSUE, '--nope']],
		[MISSING_VALUE, [ISSUE, REPO_FLAG]],
	])(UNDEFINED_ON, (_label, argv) => {
		expect(cli_flags.arguments_of(argv, OPTIONS)).toBeUndefined()
	})
})

describe('cli_flags.string_of', () => {
	it('passes a string through', () => {
		expect(cli_flags.string_of(REPO)).toBe(REPO)
	})

	it.each([
		['absent', undefined],
		['a boolean', true],
		['a list', [REPO]],
	])('answers undefined for %s', (_label, value) => {
		expect(cli_flags.string_of(value)).toBeUndefined()
	})
})

describe('cli_flags.refuse_unknown_flags', () => {
	it('answers undefined when every argument is known', () => {
		expect(cli_flags.refuse_unknown_flags(['--dry-run'], ['--dry-run'], 'adopt')).toBeUndefined()
	})

	it('names the unknown arguments and the usage line', () => {
		expect(cli_flags.refuse_unknown_flags(['--dryrun'], ['--dry-run'], 'adopt')).toBe(
			'Unknown argument(s): --dryrun\nUsage: josh adopt [--dry-run]',
		)
	})
})
