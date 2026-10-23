import { afterEach, describe, expect, it, vi } from 'vitest'
import { cli_flags } from './cli-flags'

const OPTIONS = { json: { type: 'boolean' }, repo: { type: 'string' } } as const
const ISSUE = '2902'
const REPO_FLAG = '--repo'
const REPO = 'owner/name'
const UNKNOWN_FLAG = 'an unknown flag'
const MISSING_VALUE = 'a string option with no value'
const UNDEFINED_ON = 'answers undefined on %s'
const ALL_KNOWN = 'answers undefined when every argument is known'

afterEach(() => {
	vi.restoreAllMocks()
})

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
	it(ALL_KNOWN, () => {
		expect(cli_flags.refuse_unknown_flags(['--dry-run'], ['--dry-run'], 'adopt')).toBeUndefined()
	})

	it('names the unknown arguments and the usage line', () => {
		expect(cli_flags.refuse_unknown_flags(['--dryrun'], ['--dry-run'], 'adopt')).toBe(
			'Unknown argument(s): --dryrun\nUsage: josh adopt [--dry-run]',
		)
	})
})

describe('cli_flags.usage_line', () => {
	it('lists every known flag after the command', () => {
		expect(cli_flags.usage_line(['--dry-run', '--force'], 'adopt')).toBe(
			'Usage: josh adopt [--dry-run] [--force]',
		)
	})

	it('shows the bare command when it takes no flags', () => {
		expect(cli_flags.usage_line([], 'release:github')).toBe('Usage: josh release:github')
	})
})

describe('cli_flags.answer_help_or_unknown', () => {
	it.each(['--help', '-h'])('prints the usage and answers 0 on %s', (flag) => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(cli_flags.answer_help_or_unknown([flag], ['--dry-run'], 'release')).toBe(0)
		expect(info).toHaveBeenCalledWith('Usage: josh release [--dry-run]')
	})

	it('refuses an unknown argument with 1', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(cli_flags.answer_help_or_unknown(['--dryrun'], ['--dry-run'], 'release')).toBe(1)
		expect(error).toHaveBeenCalledWith(
			'Unknown argument(s): --dryrun\nUsage: josh release [--dry-run]',
		)
	})

	it(ALL_KNOWN, () => {
		expect(
			cli_flags.answer_help_or_unknown(['--dry-run'], ['--dry-run'], 'release'),
		).toBeUndefined()
	})
})

describe('cli_flags.option_name', () => {
	it('drops the long-flag prefix', () => {
		expect(cli_flags.option_name('--decision-file')).toBe('decision-file')
	})
})

describe('cli_flags.attach_values', () => {
	const BODY_FLAG = '--body'

	it('joins a dash-led value to its flag so parseArgs reads it as the value', () => {
		const argv = cli_flags.attach_values([BODY_FLAG, '-x', '--json'], [BODY_FLAG])
		const values = cli_flags.values_of(argv, {
			body: { type: 'string' },
			json: { type: 'boolean' },
		})

		expect({ ...values }).toStrictEqual({ body: '-x', json: true })
	})

	it('leaves flags it was not given unjoined', () => {
		expect(cli_flags.attach_values([REPO_FLAG, '-x'], [BODY_FLAG])).toStrictEqual([REPO_FLAG, '-x'])
	})

	it('leaves a trailing flag with no value as it is', () => {
		expect(cli_flags.attach_values([ISSUE, BODY_FLAG], [BODY_FLAG])).toStrictEqual([
			ISSUE,
			BODY_FLAG,
		])
	})
})

describe('cli_flags.is_value_unusable', () => {
	it.each([
		['the flag is absent', [ISSUE]],
		['the value follows the flag', [REPO_FLAG, REPO]],
		['the value is inline', [`${REPO_FLAG}=${REPO}`]],
		['the value is the stdin dash', [REPO_FLAG, '-']],
		['an unknown flag sits elsewhere', ['--nope', REPO_FLAG, REPO]],
	])('answers false when %s', (_label, argv) => {
		expect(cli_flags.is_value_unusable(argv, REPO_FLAG)).toBe(false)
	})

	it.each([
		['the flag is last', [ISSUE, REPO_FLAG]],
		['another flag follows it', [REPO_FLAG, '--json']],
		['the inline value is empty', [`${REPO_FLAG}=`]],
		['one of two values is missing', [REPO_FLAG, REPO, REPO_FLAG]],
	])('answers true when %s', (_label, argv) => {
		expect(cli_flags.is_value_unusable(argv, REPO_FLAG)).toBe(true)
	})
})

const SETTING = 'JOSH_TEST_LIMIT'
const FALLBACK = 4
const PAST_SAFE = '9007199254740993'
const REFUSES = 'refuses %s'
const REFUSED_EVERYWHERE: ReadonlyArray<readonly [string, string | undefined]> = [
	['a negative number', '-1'],
	['a decimal', '1.5'],
	['a word', 'abc'],
	['an empty string', ''],
	['a padded number', ' 3'],
	['a hexadecimal', '0x10'],
	['a number past the safe range', PAST_SAFE],
	['an absent value', undefined],
]

describe('cli_flags.to_count', () => {
	it.each([
		['0', 0],
		['7', 7],
		['007', 7],
	])('reads %s as %d', (raw, expected) => {
		expect(cli_flags.to_count(raw)).toBe(expected)
	})

	it.each(REFUSED_EVERYWHERE)(REFUSES, (_label, raw) => {
		expect(cli_flags.to_count(raw)).toBeUndefined()
	})
})

describe('cli_flags.to_positive', () => {
	it('reads a positive integer', () => {
		expect(cli_flags.to_positive('12')).toBe(12)
	})

	it.each([...REFUSED_EVERYWHERE, ['zero', '0'], ['a leading zero', '05']] as const)(
		REFUSES,
		(_label, raw) => {
			expect(cli_flags.to_positive(raw)).toBeUndefined()
		},
	)
})

describe('cli_flags.read_positive_setting', () => {
	it.each([
		['unset', undefined],
		['blank', '  '],
	])('answers the fallback when %s', (_label, raw) => {
		expect(cli_flags.read_positive_setting(raw, SETTING, FALLBACK)).toEqual({
			kind: 'limit',
			limit: FALLBACK,
		})
	})

	it('reads a trimmed positive integer', () => {
		expect(cli_flags.read_positive_setting(' 2 ', SETTING, FALLBACK)).toEqual({
			kind: 'limit',
			limit: 2,
		})
	})

	it.each(['0', '-3', '2.5', 'two'])('names the setting and the value for %s', (raw) => {
		expect(cli_flags.read_positive_setting(raw, SETTING, FALLBACK)).toEqual({
			kind: 'problem',
			problem: `${SETTING} must be a positive integer, not "${raw}"`,
		})
	})
})
