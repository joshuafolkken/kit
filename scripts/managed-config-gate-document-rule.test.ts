import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1578. The managed config-file confirmation stop was a paragraph telling the run
// to compare `git diff main...HEAD` against three arrays in `scripts/init/init-logic.ts` by eye, and
// over one epic's children two of the three pull requests that changed a distributed file merged
// without the comparison being made at all. One of those two could not have succeeded by eye:
// `AI_COPY_DIRECTORIES` holds directories, so the changed path matched no entry textually.
//
// What these markers pin is that the answer is a command's and the stop is the merge command's —
// the shape `josh review:level` and `josh latest:scope` already have. A reword that puts the
// judgement back on the reader is the specific regression, so each marker is a sentence that would
// have to survive one.

const DOCS = 'docs/josh-commands.md'
const FOLLOWUP_SKILL = '.claude/skills/workflow-commands/followup.md'
const CHAIN_RULE_SKILL = '.claude/skills/workflow-commands/chain-rule.md'

const COMMAND = 'sync:scope'
const ALIAS = 'sys'
const SCRIPT_PATH = 'scripts/sync/managed-config-scope-cli.ts'
const BYPASS_FLAG = '--managed-config-ignore-reason'

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
	// Which command raises the stop — the half that makes it impossible to skip. "tracked" is
	// load-bearing: the untracked files are not in the pull request the body asserts about.
	'`pnpm josh followup` reads the tracked branch diff itself',
	// The one run the gate does not apply to, so it is not re-added as an unconditional stop.
	'A run passing `--no-merge` is not gated',
	// Why it precedes the CI wait rather than following it, so the ordering is not "tidied" back.
	'exits non-zero ahead of the CI wait',
	// The measurement, kept in the document so the rule is not read as precaution.
	'skipped in two runs out of three',
	// The case an eye comparison structurally cannot catch.
	'appears in no list textually',
	// The bypass, and that it leaves a trail.
	'the reason is auditable',
	'A blank one is not a reason',
]

const CHAIN_RULE_MARKERS: ReadonlyArray<string> = [
	// The stopping condition itself, unchanged — `chain-rule-document-rule.test.ts` pins this too,
	// deliberately: this file asserts the sentence that was *added* beside it, and would pass on a
	// document that had lost the condition entirely.
	'The managed config-file confirmation gate',
	'`pnpm josh followup` raises this one itself',
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

	it('documents the bypass flag on josh followup', () => {
		expect(read_repo_file(DOCS)).toContain(BYPASS_FLAG)
	})
})

describe('the followup skill states the gate as a mechanism', () => {
	it.each(FOLLOWUP_MARKERS)('states %j', (marker) => {
		expect(read_unwrapped(FOLLOWUP_SKILL)).toContain(marker)
	})

	it('names all three distribution lists', () => {
		const content = read_unwrapped(FOLLOWUP_SKILL)

		for (const list_name of LIST_NAMES) expect(content).toContain(list_name)
	})

	it('points at the command that answers the same question', () => {
		expect(read_unwrapped(FOLLOWUP_SKILL)).toContain('pnpm josh sync:scope')
	})

	it('names the bypass flag', () => {
		expect(read_unwrapped(FOLLOWUP_SKILL)).toContain(BYPASS_FLAG)
	})

	// The old instruction sent the run to compose the notification itself. It does not any more, and
	// leaving the sentence behind would have two documents disagreeing about who sends it.
	it('no longer tells the run to send the confirmation by hand', () => {
		expect(read_unwrapped(FOLLOWUP_SKILL)).not.toContain(
			'CI status check indicates a managed config file was updated',
		)
	})
})

describe('the chain rule keeps the stopping condition and says who raises it', () => {
	it.each(CHAIN_RULE_MARKERS)('states %j', (marker) => {
		expect(read_unwrapped(CHAIN_RULE_SKILL)).toContain(marker)
	})
})
