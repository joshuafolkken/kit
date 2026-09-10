import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1719. joshuafolkken/kit#1714 carried the budget across the cut and left the
// keystroke in place, so `backlogrun` still stopped roughly every 50 minutes against a declared budget
// of eight hours. The supervisor is what removes the keystroke.
//
// Two documents have to agree about it, and they are consulted in different situations: the command
// reference is what a person reads to control the thing, and `backlogrun.md` is what a run reads to
// know it must start and stop it. A contract written in one of them is one the reader of the other
// never reaches — which is what these markers pin.

const COMMAND_DOC = 'docs/josh-commands.md'
const BACKLOGRUN = '.claude/skills/workflow-commands/backlogrun.md'
const EPICRUN = '.claude/skills/workflow-commands/epicrun.md'

const WAKE_COMMAND = 'run:wake'
const WAKE_ALIAS = 'rw'

const COMMAND_DOC_MARKERS: ReadonlyArray<string> = [
	// The whole safety property: the record decides, and the agent does not.
	'Whether to wake is the carry record',
	// Why the 8-hour bound needs no second implementation, and why writing one would be wrong.
	'therefore needs no check of its own',
	// The trap joshuafolkken/kit#1722's hand-over note walks a reader into. Named as owner, the
	// supervisor is answered `busy` by the very session it woke, and the run never resumes.
	'never declares itself the record',
	// The invariant that keeps an unattended waker from widening what may be run.
	'`auto-ok` is still a person',
	// Why the binary is a constant rather than a setting, and the flag whose absence is deliberate
	// rather than an oversight — the one line that stops someone "fixing" it by copying the eval
	// harness.
	'a constant, not configuration',
	'does not carry `--dangerously-skip-permissions`',
	// Why the detector is the unclaimed record rather than an exit code.
	'not being claimed within ten minutes',
	// The last acceptance criterion: a person can still find it and stop it.
	'A person can always find it and stop it',
	// The stdout/stderr split every `run:*` command shares, so a loop can branch on one token.
	'Standard output carries exactly one token',
]

const BACKLOGRUN_MARKERS: ReadonlyArray<string> = [
	// Where the run starts and stops it — the two steps that would otherwise have to be invented.
	'pnpm josh run:wake --start',
	'pnpm josh run:wake --stop',
	// The boundary decision B drew, restated where a run reads it: the supervisor spends a declared
	// budget and never declares another.
	'A new authorization is still a person',
	// Why `--cut` matters more once nothing waits for a person: a skipped cut is now a run that stops
	// silently rather than one that merely asks.
	'It is what marks the record handed off',
	// The report line the acceptance criteria ask for, and the invariant it makes checkable.
	'one wake per cut',
]

describe(`${COMMAND_DOC} — the supervisor's contract is written down`, () => {
	const content = read_unwrapped(COMMAND_DOC)

	it('has the section as a heading of its own', () => {
		expect(read_repo_file(COMMAND_DOC)).toMatch(/^### `josh run:wake`$/mu)
	})

	it.each(COMMAND_DOC_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${BACKLOGRUN} — the run knows to start and stop it`, () => {
	const content = read_unwrapped(BACKLOGRUN)

	it.each(BACKLOGRUN_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The sentence this Issue replaced said the supervisor was a separate deliverable tracked
	// elsewhere. Left standing beside the command, it would send a reader looking for something that
	// is now in front of them.
	it('no longer defers the supervisor to another issue', () => {
		expect(content).not.toContain('is a separate deliverable')
		expect(content).not.toContain('What still waits for a person, today')
	})
})

describe(`${EPICRUN} — the carve-out names the supervisor too`, () => {
	// `epicrun.md` is where the cut procedure lives, and its `backlogrun` carve-out is the paragraph a
	// run reads to learn the cut does not stop it there. Naming the record without naming the thing
	// that acts on it leaves that paragraph describing half the mechanism.
	it('names the command that removes the keystroke', () => {
		expect(read_unwrapped(EPICRUN)).toContain('`pnpm josh run:wake` then starts')
	})
})

describe('the command is registered', () => {
	it('is in the command map', () => {
		expect(COMMAND_MAP[WAKE_COMMAND]?.script).toBe('scripts/run/run-wake-cli.ts')
	})

	it('has its alias', () => {
		expect(ALIASES[WAKE_ALIAS]).toBe(WAKE_COMMAND)
	})

	// It sends a Telegram on a failed wake, and those credentials come from `.env`.
	it('is given the environment file flags', () => {
		expect(COMMAND_MAP[WAKE_COMMAND]?.tsx_arguments).toBeDefined()
	})
})
