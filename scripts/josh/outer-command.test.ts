import { describe, expect, it } from 'vitest'
import { outer_command } from './outer-command'

const { KEY } = outer_command
const OUTER = 'check:related'
const NESTED = 'test:related'

describe('outer_command.mark', () => {
	it('marks the first command of a process tree', () => {
		const environment: Record<string, string | undefined> = {}

		outer_command.mark(OUTER, environment)

		expect(environment[KEY]).toBe(OUTER)
	})

	it('keeps the outer mark when a nested command dispatches', () => {
		const environment: Record<string, string | undefined> = { [KEY]: OUTER }

		outer_command.mark(NESTED, environment)

		expect(environment[KEY]).toBe(OUTER)
	})

	it('marks over the blank mark a launched lane child starts with', () => {
		const environment: Record<string, string | undefined> = { [KEY]: '' }

		outer_command.mark(NESTED, environment)

		expect(environment[KEY]).toBe(NESTED)
	})
})

describe('outer_command.is_outermost', () => {
	it('answers for the command the tree started from alone', () => {
		const source = { [KEY]: NESTED }

		expect(outer_command.is_outermost(NESTED, source)).toBe(true)
		expect(outer_command.is_outermost(OUTER, source)).toBe(false)
		expect(outer_command.is_outermost(NESTED, {})).toBe(false)
	})
})
