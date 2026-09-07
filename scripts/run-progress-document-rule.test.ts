import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1520. Two halves have to stay written down, because each one is a thing the run
// used to get wrong. The command's contract — silence rather than a clock, observations rather than
// "still running", no Telegram, no unread verification result — and the fact that `epicrun` starts it
// **itself**, which is the half that turns the reporting from something a person asks for every run
// into something that happens.

const DOCS = 'docs/josh-commands.md'
const SKILL = '.claude/skills/workflow-commands/epicrun.md'
const COMMAND = 'run:progress'
const ALIAS = 'rg'
const SCRIPT_PATH = 'scripts/run/run-progress-cli.ts'
const SECTION = 'Progress while the run is quiet'
const STATES = 'states: %s'

const DOC_MARKERS: ReadonlyArray<string> = [
	// The trigger, said as the thing it is not.
	'The trigger is silence, not a clock',
	'a line never lands immediately behind a real one',
	// The rejected design, kept named so nobody re-derives the parent-polling shape.
	'a parent that waits and reports spends one of its own turns per heartbeat',
	// The stdout/stderr split every `run:*` command shares.
	'Standard output carries the progress line and nothing else',
	// The two prohibitions this repository keeps relearning.
	'It cannot send a Telegram, and that is structural rather than a promise',
	'The line reports no verification result, because it reads none',
	// The measurement behind the default, so a future change to it has to argue with the numbers.
	'6 of 15 reports carried no changed number at all',
	// Configurable and disable-able, which is an acceptance condition rather than a nicety.
	'JOSH_PROGRESS_INTERVAL_MINUTES',
	'JOSH_PROGRESS=0',
	// Idle and unreadable are not one answer.
	'A repository with nothing in flight is told apart from one whose listing could not be read',
]

const SKILL_MARKERS: ReadonlyArray<string> = [
	// The auto-start, and why being asked for it is a failure rather than a preference.
	'Start the progress watcher before step 1 of the loop, and do it without being asked',
	'It starts by itself, and that is the requirement rather than a convenience',
	'A run that has to be asked has not solved it',
	// What keeps the heartbeat off the heels of a real report.
	'`--mark` at every real report',
	// The content rule, and the two output rules.
	'The line carries observations, never "still running"',
	'a result nobody read must never be printed as one',
	'It goes to the session only',
	'Nothing is reported while no child is in flight',
	// The scope left deliberately narrow, so widening it is a decision somebody makes on purpose.
	'A standalone `fullrun` or `queue` does not start it',
]

describe(`${DOCS} — the command's contract is written down`, () => {
	const content = read_unwrapped(DOCS)

	it('gives the command a section of its own', () => {
		expect(read_repo_file(DOCS)).toMatch(/^### `josh run:progress`$/mu)
	})

	it.each(DOC_MARKERS)(STATES, (marker) => {
		expect(content).toContain(marker)
	})

	it('sends the reader to the loop that starts it', () => {
		expect(content).toContain(`\`${SKILL}\` → "${SECTION}"`)
	})
})

describe(`${SKILL} — the run starts the watcher itself`, () => {
	const content = read_unwrapped(SKILL)

	it('gives the rule a section of its own', () => {
		expect(read_repo_file(SKILL)).toMatch(new RegExp(`^## ${SECTION}$`, 'mu'))
	})

	it.each(SKILL_MARKERS)(STATES, (marker) => {
		expect(content).toContain(marker)
	})

	it('places the section in front of the loop it precedes', () => {
		const source = read_repo_file(SKILL)

		expect(source.indexOf(`## ${SECTION}`)).toBeLessThan(source.indexOf('## The loop'))
	})
})

describe('the command is registered', () => {
	it('runs the CLI the documentation names', () => {
		expect(COMMAND_MAP[COMMAND]?.script).toBe(SCRIPT_PATH)
	})

	it('is reachable by its alias', () => {
		expect(ALIASES[ALIAS]).toBe(COMMAND)
	})
})
