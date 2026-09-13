import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1582: joshuafolkken/kit#1169 took the version off the branch and put it behind
// one command a person types, and no document ever said when to type it. Nothing fails when nobody
// does — CI is green, every pull request is merged, every Issue is closed — so 53 merges reached
// main unreleased and no consumer of this package saw one of them.
//
// The rule is a position plus a command's answer. Each marker below is one place it has to be
// readable from: the single source, the three entry points that reach a merge, and the command
// reference. A rule stated only in the single source is one an entry point following its own file
// never reaches; a rule restated in each entry is the clone `CLAUDE.md` prohibits — hence one
// section and three pointers.

// The release-timing section moved out of `followup.md` into its post-execution reference
// (joshuafolkken/kit#1905); it is still the single source of the rule.
const SINGLE_SOURCE = '.claude/skills/workflow-commands/followup-reference.md'
const DOCS = 'docs/josh-commands.md'
const SCOPE_COMMAND = 'release:scope'
const SCOPE_ALIAS = 'res'
const SECTION_TITLE = 'When `pnpm josh release` runs'
const SCOPE_INVOCATION = 'pnpm josh release:scope'

// The entry points that end in a merge. `halfrun` and `kickoff` are deliberately absent: neither
// merges anything, so neither has a release to owe.
const POINTER_FILES: ReadonlyArray<string> = [
	'.claude/skills/workflow-commands/fullrun.md',
	'.claude/skills/workflow-commands/queue.md',
	'.claude/skills/workflow-commands/epicrun.md',
]

// Each of these is a half of the rule that fails silently on its own. Dropping the position gives a
// release cut mid-batch; dropping `unknown` collapses an unreadable count into "nothing to ship",
// which is exactly how the first 53 merges went unnoticed; dropping the Tier C sentence lets a run
// publish on its own authority.
const SINGLE_SOURCE_MARKERS: ReadonlyArray<string> = [
	SECTION_TITLE,
	SCOPE_INVOCATION,
	'The release point is a position plus a command',
	'never a judgement',
	'once per invocation, after the last merge',
	'never once per child',
	'never read as `skip`',
	'The run never types `pnpm josh release` itself',
	'Tier C',
	'`pnpm josh release --dry-run` was checked first and does not answer this',
	'no counting of its own',
	'This section is the single source',
]

const DOCS_MARKERS: ReadonlyArray<string> = [
	'### `josh release:scope`',
	'required | skip | unknown',
	'alias: josh res',
	'never** read as `skip`',
	'`josh release --dry-run` cannot answer this question',
	'A run asks that command once, after the last merge its invocation authorized',
]

describe('the release-timing rule is stated once, in followup-reference.md', () => {
	const content = read_unwrapped(SINGLE_SOURCE)

	it.each(SINGLE_SOURCE_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe('every entry point that merges points at that single source', () => {
	it.each(POINTER_FILES)('%s names the section and the command', (path) => {
		const content = read_unwrapped(path)

		expect(content).toContain(SECTION_TITLE)
		expect(content).toContain(SCOPE_INVOCATION)
	})
})

describe('the command reference documents the command and its timing', () => {
	const content = read_unwrapped(DOCS)

	it.each(DOCS_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe('the command the rule branches on exists', () => {
	it('is registered as a script entry', () => {
		expect(COMMAND_MAP[SCOPE_COMMAND]?.script).toBe('scripts/release/release-scope-cli.ts')
	})

	it('resolves from its alias', () => {
		expect(ALIASES[SCOPE_ALIAS]).toBe(SCOPE_COMMAND)
	})
})
