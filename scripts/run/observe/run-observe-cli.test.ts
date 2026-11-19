import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_observe_cli } from './run-observe-cli'

// joshuafolkken/kit#8128: `josh run:observe` reads a start or a sample request, and refuses the rest.

const ISSUE = '8035'
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const HALF_HOUR_MS = 30 * MINUTE_MS
const SAMPLE = 'ps -o rss= -p "$OBSERVE_PID"'
const SEPARATOR = '--'
const REFUSES = 'refuses %s'

function start_argv(...flags: ReadonlyArray<string>): ReadonlyArray<string> {
	return ['start', ISSUE, ...flags, SEPARATOR, 'pnpm', 'josh', 'run:board']
}

describe('run_observe_cli.request_of — start', () => {
	it('reads the offsets ascending, the sample and the command after the separator', () => {
		expect(
			run_observe_cli.request_of(start_argv('--at', '2h', '--at', '30m', '--sample', SAMPLE)),
		).toEqual({
			action: 'start',
			issue: ISSUE,
			plan: {
				command: 'pnpm josh run:board',
				sample: SAMPLE,
				offsets_ms: [HALF_HOUR_MS, 2 * HOUR_MS],
			},
		})
	})

	it.each([
		['no offset', start_argv('--sample', SAMPLE)],
		['an unreadable offset', start_argv('--at', '30s', '--sample', SAMPLE)],
		['no sample', start_argv('--at', '30m')],
		['no separator', ['start', ISSUE, '--at', '30m', '--sample', SAMPLE]],
		['no command', ['start', ISSUE, '--at', '30m', '--sample', SAMPLE, SEPARATOR]],
		['an unknown flag', start_argv('--at', '30m', '--sample', SAMPLE, '--every', '1h')],
	])(REFUSES, (_name, argv) => {
		expect(run_observe_cli.request_of(argv)).toBeUndefined()
	})
})

describe('run_observe_cli.request_of — sample and the rest', () => {
	it('reads a sample request', () => {
		expect(run_observe_cli.request_of(['sample', ISSUE])).toEqual({
			action: 'sample',
			issue: ISSUE,
		})
	})

	it.each([
		['a sample with extra arguments', ['sample', ISSUE, 'now']],
		['an issue that is not a number', ['sample', 'latest']],
		['no issue', ['sample']],
		['an unknown action', ['stop', ISSUE]],
	])(REFUSES, (_name, argv) => {
		expect(run_observe_cli.request_of(argv)).toBeUndefined()
	})
})

describe('run_observe_cli.run — a refused request', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('prints the usage and fails', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await run_observe_cli.run(['sample'])).toBe(1)
		expect(error).toHaveBeenCalledWith(run_observe_cli.USAGE)
	})
})
