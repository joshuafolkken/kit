import { describe, expect, it } from 'vitest'
import { time_shell } from './time-shell'

// What a `pnpm josh <cmd>` call passed after its subcommand (joshuafolkken/kit#1383).
//
// The arguments are what tells two runs of one verification check apart, so the cases below are about
// the three spellings the prefix takes and about reading them from the segment that actually ran the
// command — the two ways a wrong answer here would turn ordinary feedback into a reported repeat.

describe('josh_arguments', () => {
	it('reads the words after the subcommand', () => {
		expect(time_shell.josh_arguments('pnpm josh test:related a.ts b.ts')).toEqual(['a.ts', 'b.ts'])
	})

	it('answers none for a call that passed no argument', () => {
		expect(time_shell.josh_arguments('pnpm josh gate')).toEqual([])
	})

	it('reads past the bare `josh` spelling', () => {
		expect(time_shell.josh_arguments('josh lint:related x.ts')).toEqual(['x.ts'])
	})

	it('reads past `pnpm exec`', () => {
		expect(time_shell.josh_arguments('pnpm exec josh lint:related x.ts')).toEqual(['x.ts'])
	})

	it('reads only the segment that ran the command', () => {
		const command = 'cd /tmp && pnpm josh lint:related a.ts | tail -5'

		expect(time_shell.josh_arguments(command)).toEqual(['a.ts'])
	})

	it('answers none for a command that is not josh', () => {
		expect(time_shell.josh_arguments('pnpm test a.ts')).toEqual([])
	})

	// The anchor `josh_command_of` already relies on, asserted here too: this repository's own commit
	// messages and issue bodies quote josh command lines constantly, and a loose read would give a
	// `git commit` call the arguments of a check it never ran.
	it('answers none for a command that merely quotes one', () => {
		expect(time_shell.josh_arguments('git commit -m "ran pnpm josh lint:related a.ts"')).toEqual([])
	})
})

// Every `pnpm josh <check>` call of the run joshuafolkken/kit#1383 was measured from was written
// `… 2>&1`, so a redirection kept as an argument would key an otherwise identical pair apart.
describe('josh_arguments — redirections', () => {
	it('drops a merged redirection', () => {
		expect(time_shell.josh_arguments('pnpm josh test:related a.ts 2>&1')).toEqual(['a.ts'])
	})

	it('drops an output redirection and the file it names', () => {
		expect(time_shell.josh_arguments('pnpm josh lint:related > out.txt')).toEqual([])
	})

	// Both characters take their file with them: reading `<` as a redirection but leaving `list.txt`
	// behind keys the call apart from the same one written without it.
	it('drops an input redirection and the file it names', () => {
		expect(time_shell.josh_arguments('pnpm josh test:related a.ts < list.txt')).toEqual(['a.ts'])
	})

	it('reads the same arguments with and without a redirection', () => {
		const redirected = time_shell.josh_arguments('pnpm josh lint:related a.ts 2>&1')

		expect(redirected).toEqual(time_shell.josh_arguments('pnpm josh lint:related a.ts'))
	})
})
