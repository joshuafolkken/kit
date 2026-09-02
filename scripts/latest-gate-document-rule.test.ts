import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { COMMAND_MAP } from '#scripts/josh/josh-logic'
import { latest_stamp } from '#scripts/version/latest-stamp'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1215: `josh latest` sat at the head of every run as "mandatory, never skip",
// costing 60–120 seconds of network time to answer the same thing several times a day. Three things
// can rot independently — a procedure can go back to running the update unconditionally, the gate
// document can stop naming the command, and the chain can stop recording the run that the command
// reads. Each is pinned here.

const COMMAND = 'pnpm josh latest:scope'
const GATE = '.claude/skills/workflow-commands/latest-gate.md'
const COMMAND_DOC = 'docs/josh-commands.md'
const RECORD_STEP = 'pnpm josh latest:scope --record'
const OLD_RULE = 'mandatory, never skip'

// Every file that tells a run whether to update. A rule written in the gate document while every
// procedure a run actually follows still ran `josh latest` unconditionally would read as shipped and
// change nothing.
const FLOW_DOCUMENTS: ReadonlyArray<string> = [
	'.claude/skills/workflow-commands/SKILL.md',
	'.claude/skills/workflow-commands/fullrun.md',
	'.claude/skills/workflow-commands/halfrun.md',
	'.claude/skills/workflow-commands/queue.md',
	'.claude/skills/workflow-commands/epicrun.md',
	GATE,
]

describe('the dependency update is routed to the command', () => {
	it.each([...FLOW_DOCUMENTS, COMMAND_DOC])('%s names the command', (document_path) => {
		expect(read_repo_file(document_path)).toContain(COMMAND)
	})

	// The point of a command is that the answer is not an agent's to reach; a procedure that names it
	// without saying so invites the reading it exists to remove.
	it.each(FLOW_DOCUMENTS)('%s says the trigger is not a judgement', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('judgement')
	})

	// The old wording is what a re-edit would restore, and it is the exact instruction the change
	// removes: an entry point still carrying it runs the update every time whatever the command says.
	// The gate document is excluded because it quotes the old rule to say what it replaced — the one
	// place the phrase is a citation rather than an instruction.
	it.each(FLOW_DOCUMENTS.filter((document_path) => document_path !== GATE))(
		'%s no longer calls the update mandatory on every run',
		(document_path) => {
			expect(read_repo_file(document_path)).not.toContain(OLD_RULE)
		},
	)
})

// The condition the issue asked for: mechanical, not a judgement, and stated where a reader lands.
describe(`${GATE} — the single source`, () => {
	const content = read_unwrapped(GATE)

	it.each([
		'Ask the command; do not decide',
		'No record answers `required`',
		'The record is written by `josh latest` itself',
		'`JOSH_LATEST_MAX_AGE_HOURS`',
		// The `dependency-update` condition is unchanged for a run in which the update actually ran,
		// which is the half a frequency change is most likely to drop.
		'load the `dependency-update` skill and follow its procedure',
		// The audit net has to be named, or a reader cannot tell whether the frequency drop lost it.
		'`Security Audit` job runs on every pull request',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('names the window the command actually defaults to', () => {
		expect(content).toContain(`${String(latest_stamp.DEFAULT_MAX_AGE_HOURS)} hours`)
	})
})

// A command that reads a record nothing writes answers `required` forever, which is the old
// behavior wearing the new command's name.
describe('the josh latest chain records the run it just made', () => {
	// eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature forbids dot access on Record values
	const latest_command = (COMMAND_MAP['latest']?.shell ?? []).join(' ')

	it('ends the chain with the record step', () => {
		expect(latest_command.trimEnd().endsWith(RECORD_STEP)).toBe(true)
	})

	// `&&` rather than `;`: a chain that recorded a run whose audit failed would tell the next run the
	// dependencies are current on the strength of a step that did not finish.
	it('records only after every earlier step succeeded', () => {
		expect(latest_command).toContain(`pnpm josh audit && ${RECORD_STEP}`)
	})

	it('registers the command that reads it', () => {
		expect(COMMAND_MAP['latest:scope']?.script).toBe('scripts/version/latest-scope-cli.ts')
	})
})
