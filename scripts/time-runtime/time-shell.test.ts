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

// What a pipeline throws away (joshuafolkken/kit#1556). A shell reports a pipeline with its last
// command's status, so the cases below are about which segments lose theirs — and, just as much,
// about which ones do not, because a caller that read `||` or the final segment as discarded would
// answer for a command whose verdict was never at risk.
// The shape joshuafolkken/kit#1556 was filed on, and the segment the pipe swallows out of it.
const GATE_REDIRECTED = 'pnpm josh gate 2>&1'

describe('discarded_commands', () => {
	it('names the command a pipe throws the status of away', () => {
		expect(time_shell.discarded_commands(`${GATE_REDIRECTED} | tail -40`)).toEqual([
			`${GATE_REDIRECTED} `,
		])
	})

	it('answers none for a command with no pipe', () => {
		expect(time_shell.discarded_commands(GATE_REDIRECTED)).toEqual([])
	})

	// `|` binds tighter than `&&`, so the command the pipe swallows is the end of the chain and never
	// the `cd` that opens it — which is how nearly every command in these transcripts is written.
	it('reads the end of the chain, not the directory change that opens it', () => {
		const command = 'cd /tmp && pnpm josh test:related a.ts | tail -5'

		expect(time_shell.discarded_commands(command)).toEqual([' pnpm josh test:related a.ts '])
	})

	// The opposite operator spelled with the same character: `||` keeps the first command's status.
	it('does not cut on `||`', () => {
		expect(time_shell.discarded_commands('pnpm josh gate || echo failed')).toEqual([])
	})

	// The last segment is the one whose status the pipeline reports, so nothing about it is discarded.
	it('leaves the final segment out', () => {
		expect(time_shell.discarded_commands('echo x | pnpm josh gate')).toEqual(['echo x '])
	})

	it('names every segment but the last', () => {
		expect(time_shell.discarded_commands('a | b | c')).toEqual(['a ', ' b '])
	})

	// A command run before the pipe on the same line keeps its own status: `a; b | c` is `a` and then
	// `b | c`, so only `b` is discarded.
	it('reads only the sub-command the pipe actually swallows', () => {
		expect(time_shell.discarded_commands('pnpm josh gate; echo done | tail')).toEqual([
			' echo done ',
		])
	})
})

// The two forms this reader stands down on. Both matter to the caller that refuses a masked check:
// answering for either would refuse a call that masked nothing, and the refusal fires once per run —
// so a wrong one spends the delivery and lets a genuinely masked call through later.
describe('discarded_commands — what it stands down on', () => {
	// `pipefail` makes the pipeline report the first failing command, so nothing in it is discarded —
	// and answering otherwise would name the very form a caller is told to use instead.
	it.each(['set -o pipefail; pnpm josh gate | tail -40', 'set -euo pipefail && a | b'])(
		'answers none under pipefail: %j',
		(command) => {
			expect(time_shell.discarded_commands(command)).toEqual([])
		},
	)

	// A quoted body is text, and this reader walks into the middle of a chain where `command_segment`
	// only ever reads the first segment that runs something — so the quote has to go first.
	it('reads no command out of a quoted body', () => {
		const command = 'gh issue comment 1 --body "cd x && pnpm josh gate | tail"'

		expect(time_shell.discarded_commands(command)).toEqual([])
	})

	// The `'` inside a double-quoted span is a character, not an opener: whichever quote opens first
	// consumes to its own close.
	it('reads the pipe outside a quote that contains the other quote character', () => {
		expect(time_shell.discarded_commands('echo "it\'s fine" | grep x')).toEqual(['echo   '])
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
