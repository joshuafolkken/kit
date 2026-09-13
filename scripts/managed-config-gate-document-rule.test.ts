import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1578 replaced an instruction telling the run to compare `git diff main...HEAD`
// against three arrays in `scripts/init/init-logic.ts` by eye: over one epic's children, two of the
// three pull requests that changed a distributed file merged without the comparison being made at
// all, and one of those two could not have succeeded by eye — `AI_COPY_DIRECTORIES` holds
// directories, so the changed path matched no entry textually.
//
// joshuafolkken/kit#1592 kept that mechanical read and removed the **stop** it fed. In kit the
// condition it tests is nearly always true, because kit is the distribution source, so the
// confirmation stopped two of three children of `epicrun #1413` over changes those Issues had
// themselves ordered.
//
// What these markers pin is both halves: that the answer is still a command's rather than the
// reader's, and that the answer is now a report rather than a merge gate. A reword that puts the
// judgement back on the reader is one regression; one that quietly reinstates the stop is the other.

const DOCS = 'docs/josh-commands.md'
// The config-file reporting section moved out of `followup.md` into its post-execution reference
// (joshuafolkken/kit#1905).
const FOLLOWUP_REFERENCE = '.claude/skills/workflow-commands/followup-reference.md'
const CHAIN_RULE_SKILL = '.claude/skills/workflow-commands/chain-rule.md'

const COMMAND = 'sync:scope'
const ALIAS = 'sys'
const SCRIPT_PATH = 'scripts/sync/managed-config-scope-cli.ts'
// Gone with the stop it existed to get past (joshuafolkken/kit#1592). **Naming it is fine; offering
// it is not** — the skill says it is gone, and that sentence is pinned below. What must not survive
// anywhere is an invocation that passes it, which `parseArgs` now refuses mid-run.
const REMOVED_FLAG = '--managed-config-ignore-reason'
// Any `followup` invocation carrying the flag, on one line — the shape a documented example takes.
const REMOVED_FLAG_INVOCATION = /pnpm josh followup[^\n]*--managed-config-ignore-reason/u

// The four sources, named rather than paraphrased: a reader who has to go and find them is back to
// the eye comparison this replaced. `SYNCED_PATHS` is the one a first pass left out, which made the
// gate narrower than the prose it replaced (joshuafolkken/kit#1578).
const LIST_NAMES: ReadonlyArray<string> = [
	'AI_COPY_FILES',
	'AI_COPY_FILE_MAPPINGS',
	'AI_COPY_DIRECTORIES',
	'SYNCED_PATHS',
]

const FOLLOWUP_MARKERS: ReadonlyArray<string> = [
	// The instruction that replaced the eye comparison, stated as a prohibition on making one.
	'Nothing here asks you to compare anything by eye',
	// Which command does the matching — the half that makes it impossible to skip. "tracked" is
	// load-bearing: the untracked files are not in the pull request the report asserts about.
	'`pnpm josh followup` reads the tracked branch diff itself',
	// joshuafolkken/kit#1592 itself. Without this sentence the section reads as a merge gate again.
	'**It stops nothing**',
	// Both destinations. Reaching only one leaves the change invisible to whichever reader used the
	// other, which is the whole of what the report is for.
	'the completion notification and the completion report on the Issue',
	// The one run that is not reported on, so it is not re-added as an unconditional section.
	'A run passing `--no-merge` is not reported on',
	// The measurement, kept so the removal reads as a finding rather than a preference — and so it is
	// not undone by someone who remembers only that a gate used to be there.
	'two of three children stopped here',
	// The rejected alternative, kept so it is not re-proposed as an improvement.
	'There is deliberately no branch on which repository this is',
	// joshuafolkken/kit#1578's own measurement, which the mechanical read still rests on.
	'skipped in two runs out of three',
	// The case an eye comparison structurally cannot catch.
	'appears in no list textually',
]

const CHAIN_RULE_MARKERS: ReadonlyArray<string> = [
	// The stopping conditions are two now, and this sentence is what stops the third being restored
	// from memory. `chain-rule-document-rule.test.ts` pins the list itself, and would pass on a
	// document that had merely dropped the gate without saying so.
	'The managed config-file gate is no longer one of them',
]

describe('josh sync:scope is a registered command', () => {
	it('is on the command map, pointing at its CLI', () => {
		expect(COMMAND_MAP[COMMAND]?.script).toBe(SCRIPT_PATH)
	})

	it('is reachable by its alias', () => {
		expect(ALIASES[ALIAS]).toBe(COMMAND)
	})

	it('is documented under its own heading', () => {
		expect(read_repo_file(DOCS)).toMatch(/^### `josh sync:scope`$/mu)
	})
})

describe('docs/josh-commands.md states how a path is matched', () => {
	it.each(LIST_NAMES)('names the %s list', (list_name) => {
		expect(read_repo_file(DOCS)).toContain(list_name)
	})

	// The boundary that makes the directory arm a containment test rather than a prefix test. It is
	// the one rule a second implementation gets wrong silently.
	it('states that a sibling directory whose name merely begins with a distributed one is excluded', () => {
		expect(read_repo_file(DOCS)).toContain('does **not** match')
	})

	it('shows no invocation passing the removed bypass flag', () => {
		expect(read_repo_file(DOCS)).not.toMatch(REMOVED_FLAG_INVOCATION)
	})
})

describe('the followup reference states the report as a mechanism', () => {
	it.each(FOLLOWUP_MARKERS)('states %j', (marker) => {
		expect(read_unwrapped(FOLLOWUP_REFERENCE)).toContain(marker)
	})

	it('names all three distribution lists', () => {
		const content = read_unwrapped(FOLLOWUP_REFERENCE)

		for (const list_name of LIST_NAMES) expect(content).toContain(list_name)
	})

	it('points at the command that answers the same question', () => {
		expect(read_unwrapped(FOLLOWUP_REFERENCE)).toContain('pnpm josh sync:scope')
	})

	// Named once, as a thing that is gone — and never as something to pass.
	it('says the bypass flag is gone', () => {
		expect(read_unwrapped(FOLLOWUP_REFERENCE)).toContain(`\`${REMOVED_FLAG}\` is gone`)
	})

	// **Read raw, not unwrapped**: `read_unwrapped` collapses the document to one line, so `[^\n]*`
	// would span the whole file and match the command name in the title against the flag named in a
	// paragraph — the regex needs the real line breaks to mean "on one line".
	it('shows no invocation passing it', () => {
		expect(read_repo_file(FOLLOWUP_REFERENCE)).not.toMatch(REMOVED_FLAG_INVOCATION)
	})

	// The old instruction sent the run to compose the notification itself. It does not any more, and
	// leaving the sentence behind would have two documents disagreeing about who sends it.
	it('no longer tells the run to send the confirmation by hand', () => {
		expect(read_unwrapped(FOLLOWUP_REFERENCE)).not.toContain(
			'CI status check indicates a managed config file was updated',
		)
	})
})

describe('the chain rule records that the gate is no longer a stopping condition', () => {
	it.each(CHAIN_RULE_MARKERS)('states %j', (marker) => {
		expect(read_unwrapped(CHAIN_RULE_SKILL)).toContain(marker)
	})
})
