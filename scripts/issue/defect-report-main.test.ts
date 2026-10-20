import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./defect-report-cli', () => ({ defect_report_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'defect:report',
	entry: 'scripts/issue/defect-report-main.ts',
	library: 'scripts/issue/defect-report-cli.ts',
	run,
})

describe('defect-report-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
