import { describe, expect, it } from 'vitest'
import { run_tail, type TailSection } from './run-tail'

const OK = 0
const FAILED = 1

function section(header: string, body: string, code = OK): TailSection {
	return { header, body, code }
}

describe('run_tail.format_report — each step under its own header', () => {
	it('joins the three sections with a blank line', () => {
		const report = run_tail.format_report([
			section(run_tail.OBSERVATIONS_HEADER, 'flushed'),
			section(run_tail.CITATIONS_HEADER, '#2372'),
			section(run_tail.RELEASE_HEADER, 'skip'),
		])

		expect(report).toBe(
			'=== observations ===\nflushed\n\n=== citations ===\n#2372\n\n=== release ===\nskip',
		)
	})
})

describe('run_tail.exit_code — a bundle is clean only when every step was', () => {
	it('exits zero when all three succeeded', () => {
		expect(run_tail.exit_code([section('a', '', OK), section('b', '', OK)])).toBe(OK)
	})

	it('exits non-zero when any step failed', () => {
		expect(run_tail.exit_code([section('a', '', OK), section('b', '', FAILED)])).toBe(FAILED)
	})
})
