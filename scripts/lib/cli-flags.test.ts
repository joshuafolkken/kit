import { describe, expect, it } from 'vitest'
import { cli_flags } from './cli-flags'

const OPTIONS = { json: { type: 'boolean' }, repo: { type: 'string' } } as const
const ISSUE = '2902'
const REPO_FLAG = '--repo'
const REPO = 'owner/name'

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
		['an unknown flag', ['--nope']],
		['a string option with no value', [REPO_FLAG]],
		['a positional the config does not allow', [ISSUE]],
	])('answers undefined on %s rather than throwing', (_label, args) => {
		expect(cli_flags.parse_or_undefined({ args, options: OPTIONS, strict: true })).toBeUndefined()
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
