import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ABANDONED_VERDICT, run_ending, UNREADABLE_VERDICT, type EndingVerdict } from './run-ending'
import { run_ending_cli } from './run-ending-cli'

const OUTPUT_FLAG = '--output'
const TRANSCRIPT = 'unit-transcript.jsonl'
const ISSUE = '2118'
const TARGET = [ISSUE, OUTPUT_FLAG, TRANSCRIPT]
const REPO = 'joshuafolkken/app-kit'
const ABANDONED_BASIS = 'subtype=success, permission_denials=3'
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

function arrange_verdict(verdict: EndingVerdict, evidence: string): void {
	vi.spyOn(run_ending, 'check').mockResolvedValue({ evidence, reason: 'why it ended', verdict })
}

describe('the request the flags describe', () => {
	it('reads the issue number and the output path', () => {
		expect(run_ending_cli.parse_request(TARGET)).toStrictEqual({
			issue: ISSUE,
			output_path: TRANSCRIPT,
		})
	})

	it('carries the repository through', () => {
		expect(run_ending_cli.parse_request([...TARGET, '--repo', REPO])?.repo).toBe(REPO)
	})
})

describe('the arguments it refuses', () => {
	it.each([
		[[ISSUE], 'no output path'],
		[[OUTPUT_FLAG, TRANSCRIPT], 'no issue number'],
		[['x', OUTPUT_FLAG, TRANSCRIPT], 'an issue number that is not one'],
		[[ISSUE, '2119', OUTPUT_FLAG, TRANSCRIPT], 'a second positional'],
		[[...TARGET, '--unknown'], 'a flag that does not exist'],
	])('refuses %j — %s', (argv) => {
		expect(run_ending_cli.parse_request(argv)).toBeUndefined()
	})
})

describe('what the command prints', () => {
	beforeEach(arrange_console)

	afterEach(() => {
		info_lines.length = 0
		error_lines.length = 0
		vi.restoreAllMocks()
	})

	it('puts the verdict alone on stdout and the basis on stderr', async () => {
		arrange_verdict(ABANDONED_VERDICT, ABANDONED_BASIS)

		const code = await run_ending_cli.run(TARGET)

		expect(code).toBe(0)
		expect(info_lines).toStrictEqual([ABANDONED_VERDICT])
		expect(error_lines.join('\n')).toContain(ABANDONED_BASIS)
	})

	it('exits non-zero on unreadable, so a caller cannot classify on a read that failed', async () => {
		arrange_verdict(UNREADABLE_VERDICT, 'a trace could not be read')

		const code = await run_ending_cli.run(TARGET)

		expect(code).toBe(1)
		expect(info_lines).toStrictEqual([UNREADABLE_VERDICT])
	})

	it('answers unreadable when the read throws', async () => {
		vi.spyOn(run_ending, 'check').mockRejectedValue(new Error(UNREACHABLE))

		const code = await run_ending_cli.run(TARGET)

		expect(code).toBe(1)
		expect(info_lines).toStrictEqual([UNREADABLE_VERDICT])
		expect(error_lines.join('\n')).toContain(UNREACHABLE)
	})

	it('prints the usage to stderr alone when the arguments do not parse', async () => {
		const code = await run_ending_cli.run([])

		expect(code).toBe(1)
		expect(info_lines).toStrictEqual([])
		expect(error_lines).toStrictEqual([run_ending_cli.USAGE])
	})
})
