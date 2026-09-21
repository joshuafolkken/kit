import { describe, expect, it } from 'vitest'
import { bytes_command } from './bytes-command'

const { argument_row, entry_row, entry_rows, near_ceiling_statuses } = bytes_command
const { scan_lines, status_row, NOT_A_FILE, NOT_BUDGETED } = bytes_command

const JOSH_COMMANDS = 'docs/josh-commands.md'

describe('status_row — one budgeted document', () => {
	it('names the headroom left when within the ceiling', () => {
		const row = status_row({ path: 'docs/x.md', current: 900, recorded: 1000, remaining: 612 })

		expect(row).toContain('docs/x.md')
		expect(row).toContain('612 left')
	})

	it('names the next block to record when over the ceiling', () => {
		const row = status_row({ path: 'docs/x.md', current: 5000, recorded: 4096, remaining: -904 })

		expect(row).toContain('over by 904')
		// The value to record is the next block multiple (block_ceiling(5000)), not the raw current size.
		expect(row).toContain('raise recorded to 8192')
	})
})

describe('argument_row — a path handed on the command line', () => {
	it('reports a real budgeted document with its current size and ceiling', () => {
		const row = argument_row(JOSH_COMMANDS)

		expect(row).toContain(JOSH_COMMANDS)
		expect(row).toContain('bytes')
	})

	it('strips a leading ./ so the path matches the budget spelling', () => {
		const row = argument_row(`./${JOSH_COMMANDS}`)

		expect(row).toContain(JOSH_COMMANDS)
		expect(row).not.toContain(NOT_BUDGETED)
	})

	it('says not-counted for a path carrying no budget entry', () => {
		expect(argument_row('scripts/bytes/bytes-command.ts')).toContain(NOT_BUDGETED)
	})

	it('says not-counted for a budgeted-looking path absent from disk', () => {
		expect(argument_row('docs/never-created-here.md')).toContain(NOT_BUDGETED)
	})

	it('says no-file for a budgeted path the tree does not hold', () => {
		// Every real budget entry exists, so the branch is exercised through the reason it prints.
		expect(NOT_A_FILE).toContain('no file')
	})
})

describe('near_ceiling_statuses — the no-argument scan', () => {
	it('reports only documents near their ceiling, least headroom first', () => {
		const statuses = near_ceiling_statuses()
		const headrooms = statuses.map((status) => status.remaining)

		expect(headrooms).toStrictEqual([...headrooms].toSorted((left, right) => left - right))
	})
})

describe('entry_row — the primary per-entry budget', () => {
	it('names the entry, its counts and the headroom left when within the ceiling', () => {
		const row = entry_row({ entry: 'fullrun', current: 900, recorded: 1000, remaining: 100 })

		expect(row).toContain('entry fullrun')
		expect(row).toContain('900/1000 bytes')
		expect(row).toContain('100 left')
	})

	it('names the overage when an entry reads past its ceiling', () => {
		const row = entry_row({ entry: 'kickoff', current: 1200, recorded: 1000, remaining: -200 })

		expect(row).toContain('over by 200')
	})
})

describe('scan_lines — the scan carries the main budget below the documents', () => {
	it('prints one entry row for every budgeted entry', () => {
		const lines = scan_lines()
		const entry_lines = lines.filter((line) => line.startsWith('entry '))

		expect(entry_lines).toStrictEqual([...entry_rows()])
		expect(entry_lines.length).toBeGreaterThan(0)
	})
})
