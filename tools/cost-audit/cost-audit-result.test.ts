import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_read } from './cost-audit-read'
import { cost_audit_result } from './cost-audit-result'

const { request_line } = cost_audit_fixture
const { BRANCH, result_line } = time_transcript_fixture

function with_effort(line: string, effort: string): string {
	return line.replace('"type":"assistant"', (type) => `${type},"effort":"${effort}"`)
}

function read(path: string): { name: string; input: unknown } {
	return { name: 'Read', input: { file_path: path } }
}

function bash(command: string): { name: string; input: unknown } {
	return { name: 'Bash', input: { command } }
}

function breakdown_of(
	...texts: ReadonlyArray<ReadonlyArray<string>>
): ReturnType<typeof cost_audit_result.breakdown_of> {
	const sessions = texts.map((lines) => cost_audit_read.session_of(lines.join('\n'), false))

	return cost_audit_result.breakdown_of(sessions)
}

describe('cost_audit_result.breakdown_of efforts', () => {
	it('prices each request at the effort its line ran at, unknown where it names none', () => {
		const result = breakdown_of([
			with_effort(request_line(1, 'a', 3), 'medium'),
			with_effort(request_line(2, 'b', 1), 'high'),
			with_effort(request_line(3, 'c', 2), 'medium'),
			request_line(4, 'd', 1),
		])

		expect(result.efforts).toEqual([
			{ effort: 'medium', usd: 5 },
			{ effort: 'high', usd: 1 },
			{ effort: cost_audit_result.UNKNOWN_EFFORT, usd: 1 },
		])
		expect(result.total_usd).toBe(7)
	})
})

describe('cost_audit_result.breakdown_of tool results', () => {
	it('charges each result to the call it answers, by tool and by josh subcommand', () => {
		const result = breakdown_of([
			request_line(1, 'a', 1, [read('/x.ts'), bash('pnpm josh run:step 1')]),
			result_line(2, BRANCH, 'a-Read', 'x'.repeat(30)),
			result_line(2, BRANCH, 'a-Bash', 'y'.repeat(10)),
		])

		expect(result.tools).toEqual([
			{ key: 'Read', results: 1, chars: 30 },
			{ key: 'Bash', results: 1, chars: 10 },
		])
		expect(result.josh).toEqual([{ key: 'josh run:step', results: 1, chars: 10 }])
	})

	it('skips a result whose call the session does not hold', () => {
		const result = breakdown_of([result_line(2, BRANCH, 'missing', 'z'.repeat(5))])

		expect(result.tools).toEqual([])
	})
})

describe('cost_audit_result.breakdown_of repeated Reads', () => {
	it('counts a Read of a path its session already read, never one another session read', () => {
		const first = [
			request_line(1, 'a', 1, [read('/x.ts')]),
			result_line(2, BRANCH, 'a-Read', 'x'.repeat(4)),
			request_line(3, 'b', 1, [read('/x.ts')]),
			result_line(4, BRANCH, 'b-Read', 'x'.repeat(6)),
		]
		const second = [
			request_line(5, 'c', 1, [read('/x.ts')]),
			result_line(6, BRANCH, 'c-Read', 'x'.repeat(8)),
		]

		expect(breakdown_of(first, second).duplicate_reads).toEqual({ files: 1, reads: 1, chars: 6 })
	})
})

describe('cost_audit_result.result_lines', () => {
	it('prints the effort shares, the tool and josh rows and the repeated Reads', () => {
		const lines = cost_audit_result.result_lines({
			total_usd: 4,
			efforts: [{ effort: 'medium', usd: 3 }],
			tools: [{ key: 'Read', results: 2, chars: 3000 }],
			josh: [],
			duplicate_reads: { files: 1, reads: 2, chars: 1500 },
		})

		expect(lines).toEqual([
			'',
			'Effort and tool results (this period: dollars and result characters)',
			'  cost by effort:',
			'    medium: $3.0000 (75.0%)',
			'  result characters by tool (top 10):',
			'    Read: 3,000 chars, 2 results, 1,500 avg',
			'  result characters by josh subcommand (top 10):',
			'    none',
			'  repeated Reads of a file the session already read: 2 reads of 1 files, 1,500 chars',
		])
	})
})
