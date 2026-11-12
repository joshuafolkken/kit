import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { gate_report } from './gate-report'

// joshuafolkken/kit#3903: a reused check prints when it last passed, never a duration it did not run.
// Kept apart from `gate-report.test.ts` because it writes a log file and captures stdout.

const make_directory = temporary_directory('suite')
const scratch = make_directory('gate-report-reused-test-')
const TAKEN_AT = '2026-10-16T01:02:03.000Z'

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
