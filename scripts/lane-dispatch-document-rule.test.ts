import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1749. The session cut's premise — "nothing has to finish, because nothing is being
// abandoned" — was false while a delegated child was an in-process subagent of the parent. These
// markers pin the three properties that make it true: the child is its own process, the launcher is
// shared rather than copied, and a launch that fails is visible.

const DOCS = 'docs/josh-commands.md'
const HANDOFF = '.claude/skills/workflow-commands/epicrun.md'
const COMMAND = 'lane:dispatch'
const ALIAS = 'lnd'
const SCRIPT_PATH = 'scripts/lane/lane-cli.ts'
const VERB = 'dispatch'

const MARKERS: ReadonlyArray<string> = [
	// The defect the command exists for, named so nobody reinstates the drain instead.
	'A delegated child used to share the parent session',
	// The no-clones requirement the Issue states outright.
	'It is the launcher [`josh run:wake`](#josh-runwake) already had, not a second one.',
	// The measurement, recorded rather than re-derived. Adding the flag is the person's decision.
	'It does not pass `--dangerously-skip-permissions`.',
	// The state that stops existing, which is what removes the hand-off's "a lane nobody could poll".
	'The output path is recorded by the same call that starts the child',
	// Visibility of a failed launch — the last acceptance criterion.
	'Every refusal warns as well as exiting non-zero.',
	// What the invocation is built from, so nothing a caller typed reaches a command line as text.
	'The invocation is composed, never passed through.',
]

describe(`${DOCS} — the command's contract is written down`, () => {
	const content = read_unwrapped(DOCS)

	it('has the section as a heading of its own', () => {
		expect(read_repo_file(DOCS)).toMatch(/^#### `josh lane:dispatch`$/mu)
	})

	it.each(MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('prints the pid on standard output, so a caller can capture one token', () => {
		expect(content).toContain('pid=$(pnpm josh lane:dispatch 1749)')
	})
})

describe(`${HANDOFF} — the premise the cut rests on`, () => {
	const content = read_unwrapped(HANDOFF)

	it('keeps the premise unconditional, with no plan-1 wording about waiting for the pool', () => {
		expect(content).toContain(
			'**There is no waiting here at all**: nothing has to finish, because nothing is being abandoned.',
		)
	})

	it('polls an in-flight lane for a process that exists, not for one that does not', () => {
		expect(content).toContain('pnpm josh run:liveness <N> --output "$unit_output" --process alive')
	})

	it('hands the child over through the dispatch command', () => {
		expect(content).toContain('pnpm josh lane:dispatch')
	})
})

describe('the command is registered', () => {
	it('runs the lane script under its own verb', () => {
		expect(COMMAND_MAP[COMMAND]?.script).toBe(SCRIPT_PATH)
		expect(COMMAND_MAP[COMMAND]?.default_script_arguments).toStrictEqual([VERB])
	})

	it(`resolves the alias ${ALIAS}`, () => {
		expect(ALIASES[ALIAS]).toBe(COMMAND)
	})
})
