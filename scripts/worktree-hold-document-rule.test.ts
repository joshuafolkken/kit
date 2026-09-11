import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1091: `epicrun` asks `epic-busy.ts` whether a repository already has a child in
// flight, and the entry points a person types never reach that guard. Two sessions therefore
// implemented two issues in one checkout at once, and a person — not the tooling — is what stopped
// the second one command before it would have committed nine files onto the first one's branch.
//
// Each marker below is one place the rule has to be readable from. The procedure lives in the skill,
// each entry file states its own branch of it, and the command reference carries the behavior; a rule
// stated in only one of the three is a rule an entry point following its own file never reaches.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const DOCS = 'docs/josh-commands.md'
const OPERATING_RULES = 'prompts/collaboration-workflow/operating-rules.md'
const ENTRY_FILES: ReadonlyArray<string> = [
	'.claude/skills/workflow-commands/fullrun.md',
	'.claude/skills/workflow-commands/halfrun.md',
]
// joshuafolkken/kit#1799: the one typed entry that does *not* claim, because it edits nothing. Its
// own file has to say so — a run following only its own file would otherwise claim a tree it never
// touches, and then release a record it never wrote.
const KICKOFF = '.claude/skills/workflow-commands/kickoff.md'
const KICKOFF_EXEMPTION =
	'**`kickoff` does not claim the working-tree hold, and does not release one**'
const OWNED_RELEASE = '**A release names the run it belongs to**'
const FORCED_RELEASE =
	'**`pnpm josh run:release --force` is the one spelling that removes a record this run did not write**'

const HOLD_COMMAND = 'run:hold'
const RELEASE_COMMAND = 'run:release'
const SCRIPT_PATH = 'scripts/run/run-hold-cli.ts'
const SECTION_POINTER = '2f. The working-tree hold — one run per tree'
const SECTION_CITATION = 'SKILL.md` → §2f'
const CHECKOUT_RULE = '**Claim it in the checkout the run will edit.**'

// The load-bearing half of the section: what it asks, when it asks, what each answer means, and the
// one thing a reader must not conclude — that the repository-scoped guard can stand in for it.
const SKILL_MARKERS: ReadonlyArray<string> = [
	`## ${SECTION_POINTER}`,
	'**Ask `pnpm josh run:hold` before anything else, and obey what it answers.**',
	'**before a `new` entry files its Issue**',
	'**`busy` — another run holds it. Stop.**',
	'**`unknown` — nothing was established. Stop the same way.**',
	'**The unit is the working tree, and `epic-busy.ts` is not reused for it**',
	"**`epicrun`'s own guard is unchanged**",
	"**Releasing is the run's, not a person's memory.**",
	CHECKOUT_RULE,
	'**An expired record over a tree that still has uncommitted changes does not free it**',
	'**The batch entry points claim per child, not per batch.**',
	'**It answers, so the entry point does not judge.**',
	'**`kickoff` does not claim it, and that is an exemption rather than an omission**',
	OWNED_RELEASE,
	FORCED_RELEASE,
	'**Release what the claim recorded, which is not always the Issue number.**',
]

// The two batch keywords never call it themselves, and a reader of either file has to be told that
// rather than left to infer it from the entry file a delegated child happens to read.
const BATCH_FILES: ReadonlyArray<string> = [
	'.claude/skills/workflow-commands/epicrun.md',
	'.claude/skills/workflow-commands/queue.md',
]

describe(`${SKILL} — the procedure is defined`, () => {
	const content = read_unwrapped(SKILL)

	it.each(SKILL_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// Every implementing entry reads the shared bullet list before it starts, so the claim is named there
// too — ahead of the split assessment, which is the step it has to precede.
describe(`${SKILL} — the shared bullet names the claim`, () => {
	it.each([
		'**The working-tree hold is claimed before anything else**',
		'**`kickoff` is exempt**',
		SECTION_POINTER,
	])('states %j', (marker) => {
		expect(read_unwrapped(SKILL)).toContain(marker)
	})
})

// The exemption is read from this file by a `kickoff` that opens nothing else, so it states both
// halves: that it does not claim, and — the half that keeps it safe — that it therefore releases
// nothing either.
describe(`${KICKOFF} — the exempt entry says it does not claim`, () => {
	it.each([KICKOFF_EXEMPTION, SECTION_CITATION])('states %j', (marker) => {
		expect(read_unwrapped(KICKOFF)).toContain(marker)
	})
})

// Per entry file rather than over their concatenation: each is read alone, so a sentence that landed
// in two of the three leaves the third's run unguarded.
describe.each(ENTRY_FILES)('%s — the entry states its own branch', (path) => {
	const content = read_unwrapped(path)

	it.each(['**Claim the working tree before anything else', SECTION_CITATION])(
		'states %j',
		(marker) => {
			expect(content).toContain(marker)
		},
	)
})

describe.each(BATCH_FILES)('%s — the batch entry says it claims per child', (path) => {
	it.each(['**The working-tree hold is claimed per child, never per batch.**', SECTION_CITATION])(
		'states %j',
		(marker) => {
			expect(read_unwrapped(path)).toContain(marker)
		},
	)
})

describe(`${DOCS} — the command reference documents the behavior`, () => {
	const content = read_unwrapped(DOCS)

	it.each([
		'**The unit is the working tree, not the repository.**',
		'**An unreadable record answers `busy`, never `hold`.**',
		'**A claim never overwrites a record that is already there.**',
		'**Two claims racing for one tree cannot both win.**',
		'**The record does not outlive the run in either direction.**',
		'**The pid is recorded for the person reading the stop, never as the liveness test**',
		"**Age alone never frees a tree, because some holds are held across a person's latency.**",
		CHECKOUT_RULE,
		OWNED_RELEASE,
		FORCED_RELEASE,
		'**`kickoff` does not ask it**',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${OPERATING_RULES} — the canonical topic carries the trigger`, () => {
	const content = read_unwrapped(OPERATING_RULES)

	it.each([
		'### 作業ツリーは 1 本のランが保持する（`josh run:hold`）',
		'**判定の単位は作業ツリーであり、リポジトリではない。**',
		'**`epicrun` 側の既存ガードは変更しない**',
		'**`kickoff` は対象外である**',
		'**解除は、どのランのものかを名乗る**',
		SECTION_POINTER,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// A documented command nothing registers is a command an entry point cannot run.
describe('the command is registered', () => {
	it.each([HOLD_COMMAND, RELEASE_COMMAND])('%s runs the guard script', (name) => {
		expect(COMMAND_MAP[name]?.script).toBe(SCRIPT_PATH)
	})

	it('gives run:release the flag that tells the one script apart', () => {
		expect(COMMAND_MAP[RELEASE_COMMAND]?.default_script_arguments).toEqual(['--release'])
	})

	it.each([
		['rh', HOLD_COMMAND],
		['rr', RELEASE_COMMAND],
	])('resolves the alias %j to %j', (alias, name) => {
		expect(ALIASES[alias]).toBe(name)
	})
})
