import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1485. The detection an agent read by hand could not fire for the stop that
// actually happened, so the combining is a command now. A command whose contract is not written down
// is one a caller reconstructs from its output, which is how the four traces drifted in the first
// place — these markers are what pins the contract.

const DOCS = 'docs/josh-commands.md'
const COMMAND = 'run:liveness'
const ALIAS = 'rv'
const SCRIPT_PATH = 'scripts/run/run-liveness-cli.ts'

const MARKERS: ReadonlyArray<string> = [
	// The stdout/stderr split every `run:*` command shares, so a loop can branch on one token.
	'Standard output carries exactly one token',
	// The direction the error falls, which is the whole safety property.
	'A live unit booked as stopped has its working work killed',
	'a trace that could not be read answers `undetermined` rather than `stopped`',
	// The read that was wrong, named so nobody re-derives it from a `stat` that does not follow.
	'The output read follows the symlink, and compares the size as well as the timestamp',
	// Why the dirty-checkout trace is gone rather than merely relaxed.
	'left a clean tree and the test could never become true',
	// The one input the command refuses to guess at.
	'The process trace is the one input the command does not read for itself',
	// The two ways the answer could have gone back to never firing: a child whose unit died before it
	// applied `in-progress`, and a poll that answers `undetermined` forever over a wrong path.
	'An open child that is not parked is not `settled`, even without `in-progress`',
	'Two `undetermined` answers in a row is a fault in the check rather than a slow unit',
]

describe(`${DOCS} — the command's contract is written down`, () => {
	const content = read_unwrapped(DOCS)

	it('has the section as a heading of its own', () => {
		expect(read_repo_file(DOCS)).toMatch(/^### `josh run:liveness`$/mu)
	})

	it.each(MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// Four answers, each with a caller action. A verdict a caller cannot act on is one it will
	// interpret, which is the judgement this command exists to remove.
	it.each(['`alive`', '`stopped`', '`settled`', '`undetermined`'])(
		'documents the answer %j',
		(answer) => {
			expect(content).toContain(`| ${answer} |`)
		},
	)

	it('points at the loop that asks it', () => {
		expect(content).toContain(
			'The loop that asks it, and what each answer does there, is `.claude/skills/workflow-commands/epicrun.md` → "A delegated unit that stopped without reporting".',
		)
	})
})

describe('the command is registered', () => {
	it('runs the liveness script', () => {
		expect(COMMAND_MAP[COMMAND]?.script).toBe(SCRIPT_PATH)
	})

	it('takes no default arguments, unlike the shared run:hold script', () => {
		expect(COMMAND_MAP[COMMAND]?.default_script_arguments).toBeUndefined()
	})

	it(`resolves the alias ${ALIAS}`, () => {
		expect(ALIASES[ALIAS]).toBe(COMMAND)
	})
})
