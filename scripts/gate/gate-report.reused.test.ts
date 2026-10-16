import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { gate_report } from './gate-report'

// joshuafolkken/kit#3903: a reused check prints when it last passed, never a duration it did not run.
// Kept apart from `gate-report.test.ts` because it writes a log file and captures stdout.

const scratch = mkdtempSync(path.join(tmpdir(), 'gate-report-reused-test-'))
const TAKEN_AT = '2026-10-16T01:02:03.000Z'

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('report_gate_steps — a reused check', () => {
	it('says the check was reused and when its record was taken', () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
		const reused = {
			label: 'lint',
			command: 'josh lint',
			exit_code: 0,
			output: '',
			elapsed_ms: 0,
			reused_at: TAKEN_AT,
		}
		const report = { is_verbose: false, log_path: path.join(scratch, 'gate.log'), elapsed_ms: 1 }

		gate_report.report_gate_steps([reused], report)

		const printed = write.mock.calls.map(([chunk]) => String(chunk)).join('')

		write.mockRestore()
		expect(printed).toContain(
			`lint (pnpm josh lint) reused — inputs unchanged since it passed at ${TAKEN_AT}`,
		)
	})
})
