import { describe, expect, it } from 'vitest'
import { run_entry_cli } from './run-entry-cli'

const ISSUE = '2372'

describe('run_entry_cli.parse_number — exactly one issue number', () => {
	it('refuses zero, two, or a non-number', () => {
		expect(run_entry_cli.parse_number([])).toBeUndefined()
		expect(run_entry_cli.parse_number([ISSUE, '99'])).toBeUndefined()
		expect(run_entry_cli.parse_number(['x'])).toBeUndefined()
		expect(run_entry_cli.parse_number([ISSUE])).toBe(ISSUE)
	})
})

describe('run_entry_cli.parse_request — an issue number and an optional --to command', () => {
	it('defaults to fullrun and accepts a named ladder command', () => {
		expect(run_entry_cli.parse_request([ISSUE])).toStrictEqual({
			issue_number: ISSUE,
			command: 'fullrun',
		})
		expect(run_entry_cli.parse_request([ISSUE, '--to', 'halfrun'])?.command).toBe('halfrun')
	})

	it.each([
		[[ISSUE, '--to']],
		[[ISSUE, '--to', 'ship']],
		[[ISSUE, '--from', 'prrun']],
		[[ISSUE, '--to', 'prrun', 'extra']],
		[['--to', 'prrun']],
	])('refuses %j', (argv) => {
		expect(run_entry_cli.parse_request(argv)).toBeUndefined()
	})
})
