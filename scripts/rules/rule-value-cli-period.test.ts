import { existsSync } from 'node:fs'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { hook_ledger_read } from '#scripts/hooks/hook-ledger-read'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rule_value_cache } from './rule-value-cache'
import { rule_value_cli } from './rule-value-cli'

const NOW_MS = Date.parse('2026-11-12T00:00:00Z')
const PERIOD_DAYS = 7
const SINCE_MS = hook_ledger_read.period_start(PERIOD_DAYS, new Date(NOW_MS))
const TEMPORARY_PREFIX = 'rule-value-period-'
const make_directory = temporary_directory()

interface FakeFile {
	name: string
	owner: string
}

function fake_file(name: string, modified_ms: number): SessionFile {
	return { name, owner: name, modified_ms } as unknown as SessionFile
}

// Run `rule:value` over the listed files at `NOW_MS`, returning the names of the files it read.
function read_names(argv: ReadonlyArray<string>, files: ReadonlyArray<SessionFile>): Array<string> {
	const read: Array<string> = []

	vi.useFakeTimers({ now: NOW_MS })
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.spyOn(cost_transcript, 'list_sessions_across').mockReturnValue([...files])
	vi.spyOn(cost_transcript, 'owning_session_id').mockImplementation(
		(file) => (file as unknown as FakeFile).owner,
	)
	vi.spyOn(cost_transcript, 'read_optional').mockImplementation((file) => {
		read.push((file as unknown as FakeFile).name)

		return undefined
	})
	rule_value_cli.run_rule_value(argv, make_directory(TEMPORARY_PREFIX))

	return read
}

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('rule_value_cli.run_rule_value — --period counts only the trailing window', () => {
	const files = [
		fake_file('inside', NOW_MS - 1),
		fake_file('boundary', SINCE_MS),
		fake_file('outside', SINCE_MS - 1),
	]

	it('reads a transcript written at the window start and skips one a millisecond older', () => {
		expect(read_names(['--period', String(PERIOD_DAYS)], files)).toStrictEqual([
			'inside',
			'boundary',
		])
	})

	it('reads every transcript without --period', () => {
		expect(read_names(['--fresh'], files)).toStrictEqual(['inside', 'boundary', 'outside'])
	})
})

describe('rule_value_cli.run_rule_value — --period leaves the cache alone', () => {
	it('prints the reading to stdout and writes no cache', () => {
		const cwd = make_directory(TEMPORARY_PREFIX)
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		vi.spyOn(cost_transcript, 'list_sessions_across').mockReturnValue([])

		expect(rule_value_cli.run_rule_value(['--period', '1', '--refresh'], cwd)).toBe(0)
		expect(stdout).toHaveBeenCalledExactlyOnceWith(`${rule_value_cli.NO_TARGETS}\n`)
		expect(existsSync(rule_value_cache.cache_path(cwd, rule_value_cache.CACHE_FILE))).toBe(false)
	})

	it.each([[[]], [['0']], [['-1']], [['seven']]])(
		'refuses %j as the period with the usage line',
		(value: Array<string>) => {
			const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

			const cwd = make_directory(TEMPORARY_PREFIX)

			expect(rule_value_cli.run_rule_value(['--period', ...value], cwd)).toBe(1)
			expect(stderr).toHaveBeenCalledExactlyOnceWith(`${rule_value_cli.PERIOD_USAGE}\n`)
		},
	)
})
