import { describe, expect, it } from 'vitest'
import { run_section, type Section } from './run-section'

const OK = 0
const FAILED = 1
const SIGNAL_CODE = 130

function section(header: string, body: string, code = OK): Section {
	return { header, body, code }
}

describe('run_section.format_sections — each step under its own header', () => {
	it('puts the body on the line after its header', () => {
		expect(run_section.format_sections([section('=== a ===', 'done')])).toBe('=== a ===\ndone')
	})

	it('joins the sections with a blank line', () => {
		const report = run_section.format_sections([
			section('=== a ===', 'one'),
			section('=== b ===', 'two', FAILED),
		])

		expect(report).toBe('=== a ===\none\n\n=== b ===\ntwo')
	})

	it('is empty when no step ran', () => {
		expect(run_section.format_sections([])).toBe('')
	})
})

describe('run_section.exit_code_of — clean only when every step was', () => {
	it('exits zero when every step succeeded', () => {
		expect(run_section.exit_code_of([section('a', ''), section('b', '')])).toBe(OK)
	})

	it('exits zero when no step ran', () => {
		expect(run_section.exit_code_of([])).toBe(OK)
	})

	it('exits non-zero when any step failed', () => {
		expect(run_section.exit_code_of([section('a', ''), section('b', '', FAILED)])).toBe(FAILED)
	})

	it('answers the failure code, not the failed step’s own code', () => {
		expect(run_section.exit_code_of([section('a', '', SIGNAL_CODE)])).toBe(FAILED)
	})
})

describe('run_section — the constants the composites read', () => {
	it('names success and failure', () => {
		expect(run_section.SUCCESS_EXIT_CODE).toBe(OK)
		expect(run_section.FAILURE_EXIT_CODE).toBe(FAILED)
	})
})
