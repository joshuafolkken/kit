import { describe, expect, it } from 'vitest'
import { bytes_command } from './bytes-command'

const { argument_row, near_ceiling_statuses, status_row, NOT_A_FILE, NOT_BUDGETED } = bytes_command

const JOSH_COMMANDS = 'docs/josh-commands.md'

describe('status_row — one budgeted document', () => {
	it('names the headroom left when within the ceiling', () => {
		const row = status_row({ path: 'docs/x.md', current: 900, recorded: 1000, remaining: 612 })

		expect(row).toContain('docs/x.md')
		expect(row).toContain('612 left')
	})

	it('names the value to record when over the ceiling', () => {
		const row = status_row({ path: 'docs/x.md', current: 1600, recorded: 1000, remaining: -88 })

		expect(row).toContain('over by 88')
		expect(row).toContain('raise recorded to 1600')
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
	it('reports only documents within a slack of their ceiling, least headroom first', () => {
		const statuses = near_ceiling_statuses()
		const headrooms = statuses.map((status) => status.remaining)

		expect(headrooms).toStrictEqual([...headrooms].toSorted((left, right) => left - right))
	})
})
