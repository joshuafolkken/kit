import { describe, expect, it } from 'vitest'
import { run_record_path } from './run-record-path'

describe('is_run_record', () => {
	it.each(['.josh/metrics-accepted/4905.json', '.josh/observations/4905.md'])(
		'accepts the josh record %s',
		(relative) => {
			expect(run_record_path.is_run_record(relative)).toBe(true)
		},
	)

	it.each([
		'scripts/.josh/metrics.json',
		'.josh-handoff-4905.json',
		'scripts/gate/scoped-green.ts',
		'',
	])('refuses %j, which is not under the root .josh/ directory', (relative) => {
		expect(run_record_path.is_run_record(relative)).toBe(false)
	})
})
