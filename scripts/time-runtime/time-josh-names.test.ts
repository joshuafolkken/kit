import { afterEach, describe, expect, it, vi } from 'vitest'
import { time_josh_names } from './time-josh-names'
import { time_shell } from './time-shell'

// The josh names a reader matches against canonical ones, alias-expanded at this layer
// (joshuafolkken/kit#6161), so the readers see `gate` for `ga` though `time_shell` does not expand.
// `time_shell` is stubbed to hand back unexpanded names, so these fail on a layer that only passes through.

const LINT_RELATED = 'josh lint:related'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('josh_command_of', () => {
	it('expands the first segment alias to its canonical name', () => {
		vi.spyOn(time_shell, 'josh_command_of').mockReturnValue('josh ga')

		expect(time_josh_names.josh_command_of('pnpm josh ga')).toBe('josh gate')
	})

	it('answers empty for a call that runs no josh command', () => {
		expect(time_josh_names.josh_command_of('ls -la')).toBe('')
	})
})

describe('josh_command_of_segment', () => {
	it('expands the segment alias to its canonical name', () => {
		vi.spyOn(time_shell, 'josh_command_of_segment').mockReturnValue('josh lr')

		expect(time_josh_names.josh_command_of_segment('pnpm josh lr a.ts')).toBe(LINT_RELATED)
	})
})

describe('josh_commands_of', () => {
	it('expands the alias of every segment in a chain', () => {
		vi.spyOn(time_shell, 'josh_commands_of').mockReturnValue(['josh lr', 'josh ga'])

		expect(time_josh_names.josh_commands_of('pnpm josh lr && pnpm josh ga')).toEqual([
			LINT_RELATED,
			'josh gate',
		])
	})
})

describe('josh_signatures_of', () => {
	it('expands the subcommand and keeps the arguments unchanged', () => {
		vi.spyOn(time_shell, 'josh_signatures_of').mockReturnValue(['josh lr a.ts --x ga'])

		expect(time_josh_names.josh_signatures_of('pnpm josh lr a.ts --x ga')).toEqual([
			`${LINT_RELATED} a.ts --x ga`,
		])
	})

	it('keeps a canonical signature as it is', () => {
		expect(time_josh_names.josh_signatures_of('pnpm josh run:board --chat')).toEqual([
			'josh run:board --chat',
		])
	})
})
