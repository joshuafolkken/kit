import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	ALIVE_VERDICT,
	MS_PER_MINUTE,
	MS_PER_SECOND,
	PROCESS_NONE,
	PROCESS_UNKNOWN,
	run_liveness,
	UNDETERMINED_VERDICT,
	type LivenessVerdict,
} from './run-liveness'
import { run_liveness_cli } from './run-liveness-cli'

// The module is spied rather than mocked, for the reason `run-preflight-cli.test.ts` records: a
// module mock would blank out the constants the argument parsing reads.

const OUTPUT_FLAG = '--output'
const PROCESS_FLAG = '--process'
const TRANSCRIPT = 'unit-transcript.jsonl'
const ISSUE = '1169'
const TARGET = [ISSUE, OUTPUT_FLAG, TRANSCRIPT]
const REPO = 'joshuafolkken/app-kit'
const WRITING_REASON = 'still writing'
const UNREACHABLE = 'gh is unreachable'

const info_lines: Array<string> = []
const error_lines: Array<string> = []

function arrange_console(): void {
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		error_lines.push(line)
	})
}

function arrange_verdict(verdict: LivenessVerdict, reason: string): void {
	vi.spyOn(run_liveness, 'check').mockResolvedValue({
		advice: 'what the caller does next',
		has_work_to_stash: false,
		reason,
		verdict,
	})
}

describe('the request the flags describe', () => {
	it('reads the issue number, the output path and the process trace', () => {
		const request = run_liveness_cli.parse_request([...TARGET, PROCESS_FLAG, PROCESS_NONE])

		expect(request).toStrictEqual({
			issue: ISSUE,
			output_path: TRANSCRIPT,
			process_trace: PROCESS_NONE,
		})
	})

	// Left out, the process trace is unread rather than absent — which the decision turns into
	// `undetermined` rather than a stop.
	it('defaults the process trace to unknown', () => {
		expect(run_liveness_cli.parse_request(TARGET)?.process_trace).toBe(PROCESS_UNKNOWN)
	})

	it('converts the two durations into milliseconds', () => {
		const request = run_liveness_cli.parse_request([...TARGET, '--window', '45', '--gap', '2'])

		expect(request).toMatchObject({
			gap_ms: 2 * MS_PER_SECOND,
			silent_window_ms: 45 * MS_PER_MINUTE,
		})
	})

	it('carries the repository through', () => {
		const request = run_liveness_cli.parse_request([...TARGET, '--repo', REPO])

		expect(request?.repo).toBe(REPO)
	})
})

describe('the arguments it refuses', () => {
	// The two zero rows are the error direction the design forbids: a zero window calls any unit not
	// writing at that instant frozen, and a zero gap takes both samples back-to-back.
	it.each([
		[[ISSUE], 'no output path'],
		[[OUTPUT_FLAG, TRANSCRIPT], 'no issue number'],
		[['x', OUTPUT_FLAG, TRANSCRIPT], 'an issue number that is not one'],
		[[ISSUE, '1170', OUTPUT_FLAG, TRANSCRIPT], 'a second positional'],
		[[...TARGET, PROCESS_FLAG, 'maybe'], 'a process trace that is not one'],
		[[...TARGET, '--gap', 'soon'], 'a duration that is not a number'],
		[[...TARGET, '--window', 'later'], 'a window that is not a number'],
		[[...TARGET, '--window', '0'], 'a window of zero minutes'],
		[[...TARGET, '--gap', '0'], 'a gap of zero seconds'],
		[[...TARGET, '--unknown'], 'a flag that does not exist'],
	])('refuses %j — %s', (argv) => {
		expect(run_liveness_cli.parse_request(argv)).toBeUndefined()
	})
})

describe('what the command prints', () => {
	beforeEach(arrange_console)

	afterEach(() => {
		info_lines.length = 0
		error_lines.length = 0
		vi.restoreAllMocks()
	})

	it('puts the verdict alone on stdout and the reasoning on stderr', async () => {
		arrange_verdict(ALIVE_VERDICT, WRITING_REASON)

		const code = await run_liveness_cli.run([...TARGET, PROCESS_FLAG, 'alive'])

		expect(code).toBe(0)
		expect(info_lines).toStrictEqual([ALIVE_VERDICT])
		expect(error_lines.join('\n')).toContain(WRITING_REASON)
	})

	it('exits non-zero on undetermined, so a caller cannot proceed on a read that failed', async () => {
		arrange_verdict(UNDETERMINED_VERDICT, 'a trace could not be read')

		const code = await run_liveness_cli.run([...TARGET, PROCESS_FLAG, PROCESS_NONE])

		expect(code).toBe(1)
		expect(info_lines).toStrictEqual([UNDETERMINED_VERDICT])
	})

	// A read that threw is the same answer as a trace that could not be read, never a stop.
	it('answers undetermined when the read throws', async () => {
		vi.spyOn(run_liveness, 'check').mockRejectedValue(new Error(UNREACHABLE))

		const code = await run_liveness_cli.run([...TARGET, PROCESS_FLAG, PROCESS_NONE])

		expect(code).toBe(1)
		expect(info_lines).toStrictEqual([UNDETERMINED_VERDICT])
		expect(error_lines.join('\n')).toContain(UNREACHABLE)
	})

	it('prints the usage to stderr alone when the arguments do not parse', async () => {
		const code = await run_liveness_cli.run([])

		expect(code).toBe(1)
		expect(info_lines).toStrictEqual([])
		expect(error_lines).toStrictEqual([run_liveness_cli.USAGE])
	})
})
