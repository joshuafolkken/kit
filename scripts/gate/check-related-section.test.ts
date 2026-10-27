import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { check_related, type CheckResult } from './check-related'
import { check_related_section } from './check-related-section'

const scratch = mkdtempSync(path.join(tmpdir(), 'check-related-section-test-'))
const LOG_TARGET = path.join(scratch, 'check-related.log')
const TEST_COMMAND = 'test:related'
const LINE_COUNT = 60
// The size past which Claude Code saves a tool result instead of showing it (`BASH_MAX_OUTPUT_LENGTH`).
const TOOL_RESULT_BYTES = 8000
// joshuafolkken/kit#5168: the `test:related` that printed 142.8 KB ran 877 files.
const RELATED_FILE_COUNT = 877

function numbered_output(count: number): string {
	return Array.from({ length: count }, (_value, index) => `line ${String(index + 1)}`).join('\n')
}

function result_of(exit_code: number, output = numbered_output(LINE_COUNT)): CheckResult {
	return { command: TEST_COMMAND, exit_code, output }
}

function body_lines(section: string): Array<string> {
	return section.trimEnd().split('\n').slice(2)
}

function vitest_output(): string {
	const files = Array.from(
		{ length: RELATED_FILE_COUNT },
		(_value, index) =>
			` ✓ scripts/area-${String(index)}/some-module-${String(index)}.test.ts (12 tests) 34ms`,
	)

	return [...files, '', ' Test Files  877 passed (877)', '      Tests  9000 passed (9000)'].join(
		'\n',
	)
}

function report_size(results: ReadonlyArray<CheckResult>): number {
	const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

	check_related.report_results(results, { log_target: LOG_TARGET })

	return Buffer.byteLength(write.mock.calls.map(([chunk]) => String(chunk)).join(''))
}

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

// joshuafolkken/kit#5204: a whole `test:related` output went past the tool result's size limit.
describe('check_related_section.format_section', () => {
	it('prints the last 5 lines of a passed check under the count left out', () => {
		const section = check_related_section.format_section(result_of(0))

		expect(body_lines(section)).toStrictEqual([
			'… 55 earlier line(s) in the log',
			'line 56',
			'line 57',
			'line 58',
			'line 59',
			'line 60',
		])
	})

	it('prints the last 40 lines of a failed check', () => {
		const lines = body_lines(check_related_section.format_section(result_of(1)))

		expect(lines).toHaveLength(check_related_section.FAILED_TAIL_LINES + 1)
		expect(lines.slice(0, 2)).toStrictEqual(['… 20 earlier line(s) in the log', 'line 21'])
	})

	it('prints a short output whole, with no count line', () => {
		expect(check_related_section.format_section(result_of(0, 'one\ntwo'))).toBe(
			'\n=== test:related: passed ===\none\ntwo\n',
		)
	})

	it('prints the whole output when --full is asked', () => {
		const output = numbered_output(LINE_COUNT)

		expect(check_related_section.format_section(result_of(0, output), true)).toBe(
			`\n=== test:related: passed ===\n${output}\n`,
		)
	})

	it('prints the header alone for an empty output', () => {
		expect(check_related_section.format_section(result_of(1, ''))).toBe(
			'\n=== test:related: failed (1) ===\n',
		)
	})
})

describe('check_related_section.is_full_requested', () => {
	it('answers true only when the arguments carry --full', () => {
		expect(check_related_section.is_full_requested(['node', 'script', '--full'])).toBe(true)
		expect(check_related_section.is_full_requested(['node', 'script'])).toBe(false)
	})
})

describe('check_related.report_results size', () => {
	it('keeps a report with an 877-file test:related inside one tool result', () => {
		const results = check_related.CHECKS.map((command): CheckResult => ({
			command,
			exit_code: 0,
			output: command === TEST_COMMAND ? vitest_output() : `${command} output`,
		}))

		expect(report_size(results)).toBeLessThan(TOOL_RESULT_BYTES)
	})
})
