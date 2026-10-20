import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const report = vi.hoisted(() =>
	vi.fn<(identifiers: ReadonlyArray<string>) => Promise<{ text: string; has_failed: boolean }>>(),
)

vi.mock('#scripts/issue/plan-consumers', () => ({ plan_consumers: { report } }))

const { plan_consumers_cli } = await import('./plan-consumers-cli')

// joshuafolkken/kit#4273: the command prints the report, and fails a search that could not run.

const IDENTIFIER = 'lane:pause'
const OTHER_IDENTIFIER = 'run:paused'
const REPORT_TEXT = `${IDENTIFIER}\n  code\n\ndraft:`

const printed: Array<string> = []
const errors: Array<string> = []

beforeEach(() => {
	printed.length = 0
	errors.length = 0
	report.mockReset()
	report.mockResolvedValue({ text: REPORT_TEXT, has_failed: false })
	vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		printed.push(String(line))
	})
	vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
		errors.push(String(line))
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('plan_consumers_cli.run — prints the report', () => {
	it('searches each identifier once, trimmed, and exits 0', async () => {
		expect(await plan_consumers_cli.run([` ${IDENTIFIER} `, IDENTIFIER, OTHER_IDENTIFIER])).toBe(0)
		expect(report).toHaveBeenCalledWith([IDENTIFIER, OTHER_IDENTIFIER])
		expect(printed).toStrictEqual([REPORT_TEXT])
	})

	it('exits 1 when a search could not run, still printing the report', async () => {
		report.mockResolvedValue({ text: REPORT_TEXT, has_failed: true })

		expect(await plan_consumers_cli.run([IDENTIFIER])).toBe(1)
		expect(printed).toStrictEqual([REPORT_TEXT])
	})
})

describe('plan_consumers_cli.run — refuses a call with nothing to search', () => {
	it.each([
		{ name: 'no identifier', argv: [] },
		{ name: 'a flag', argv: ['--json'] },
		{ name: 'a blank identifier', argv: [' '] },
	])('refuses $name with the usage line', async ({ argv }) => {
		expect(await plan_consumers_cli.run(argv)).toBe(1)
		expect(errors).toStrictEqual([plan_consumers_cli.USAGE])
		expect(report).not.toHaveBeenCalled()
	})
})
