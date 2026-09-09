import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_unwrapped } from './ai-document-fixture'

/*
 * joshuafolkken/kit#1631: `backlogrun` is the entry point that runs the opted-in backlog without
 * naming an epic. Three things about it are load-bearing and none of them is visible to a reader
 * of the diff alone, so each is pinned here.
 *
 * 1. It is a separate keyword, not an argument to `epicrun`. The two authorize different sets, and
 *    an argument would have made that declaration depend on whether a number followed the keyword.
 * 2. Membership stays a person's decision (`auto-ok`); only the order and the parallelism are the
 *    run's. A run that could choose its own inputs would widen its own authorization.
 * 3. The child procedures — lanes, park-and-continue, `needs-human-review`, a prerequisite — are
 *    referenced from `epicrun.md` rather than restated. A restated copy drifts, and the copy is the
 *    one an unattended run would obey.
 */

const ENTRY_SKILL = '.claude/skills/workflow-commands/backlogrun.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const COMMAND_DOC = 'docs/josh-commands.md'
const KEYWORD = 'backlogrun'
// The keyword list of the explicit-invocation rule. Both surfaces carry it: the skill for a run that
// loaded it, `CLAUDE.md` for a turn that did not.
const INVOCATION_RULE_MARKER = '/ `epicrun` / `backlogrun` workflow'

// The declaration of what may be executed unattended. Left ambiguous, an unattended run cannot tell
// whether an issue outside every epic was approved.
const AUTHORIZATION_MARKERS: ReadonlyArray<string> = [
	'separate keyword rather than an argument to `epicrun`',
	"**What may be run stays a person's decision.**",
	'`auto-ok` is applied only by a person',
	// The issues the run files are approved to be *filed*, not to be run: they carry no `auto-ok`.
	'**filing them, not running them**',
]

// The output contract of `pnpm josh backlog:next`, which the loop is written against. Each of these
// is a way the loop reads the answer wrongly if the sentence is lost.
const CONTRACT_MARKERS: ReadonlyArray<string> = [
	// All four verdicts exit 0, so a loop branching on the exit status cannot see `error` at all.
	'`error` cannot be told apart by exit code, so read the token rather than the status',
	// Exit 1 is "no answer", and reading it as `none` reports an empty backlog nobody saw.
	'**it is not `none`**',
	// A qualified token was implemented and withdrawn: `--exclude` parses bare integers only.
	'So `backlogrun` takes no `owner/repo#N` token.',
	// A just-merged issue still reads as open for a few seconds and would be offered twice.
	'Feed every issue this run has merged back through `--exclude`',
	// The standalone half is capped at five rows, so a short offer is not an empty backlog.
	'A short offer is not proof the backlog is empty.',
	// A `wait` whose only candidates are elsewhere never resolves here, so polling it is a dead end.
	// joshuafolkken/kit#1632 reconciled that arm with the idle watch rather than layering one on top:
	// waiting still cannot resolve those candidates, but a person opting a new issue in here can, so
	// the row hands the case to `backlog:budget` as `exhausted` and the ending is the watch's. With no
	// watch asked for, `exhausted` still answers `stop` and the run finishes exactly as it did.
	'`wait` this checkout can never resolve',
	'so the ending is the idle watch',
]

// The known limit joshuafolkken/kit#1633 recorded rather than fixed. Asserting the opposite anywhere
// would send a reader looking for children that the listing cannot see.
const KNOWN_LIMIT_MARKER = 'invisible to the listing'

// The sections whose procedure stays `epicrun.md`'s. Named here so a future edit that inlines one
// has to delete the reference first.
const REFERENCED_SECTIONS: ReadonlyArray<string> = [
	'Lanes',
	'park and continue',
	'A prerequisite discovered mid-run',
	'`needs-human-review` — the one stop that is not a park',
	'Preflight',
	'Progress while the run is quiet',
	'The hand-off',
	'Guards',
]

// Restating a child procedure here is what the acceptance criterion forbids. These are the command
// spellings that only the restated copy would carry.
const RESTATEMENT_MARKERS: ReadonlyArray<string> = [
	'pnpm josh lane:open',
	'git stash push -u -m',
	'gh api repos/{owner}/{repo}/issues/',
]

describe(`${ENTRY_SKILL} — the entry point's own declarations`, () => {
	const entry = read_unwrapped(ENTRY_SKILL)

	it.each(AUTHORIZATION_MARKERS)('states %j', (marker) => {
		expect(entry).toContain(marker)
	})

	it.each(CONTRACT_MARKERS)('writes the loop against the command contract: %j', (marker) => {
		expect(entry).toContain(marker)
	})

	it('records the epic-label limit rather than asserting it away', () => {
		expect(entry).toContain(KNOWN_LIMIT_MARKER)
	})

	// The rule is resident in `CLAUDE.md` for a turn where nothing here was read; the entry file owes
	// the reader the same rule at the same strength, because this keyword approves the widest set.
	it('requires explicit invocation at the strength the other five carry', () => {
		expect(entry).toContain(
			"**Never start a `backlogrun` unless the user has typed the keyword in the current turn's prompt.**",
		)
		expect(entry).toContain('Please run `backlogrun` to start this task.')
	})
})

describe(`${ENTRY_SKILL} — references the child procedures instead of restating them`, () => {
	const entry = read_unwrapped(ENTRY_SKILL)

	it.each(REFERENCED_SECTIONS)('routes %j to epicrun.md', (section) => {
		expect(entry).toContain(`\`epicrun.md\` → "${section}"`)
	})

	it.each(RESTATEMENT_MARKERS)('does not restate the procedure that carries %j', (marker) => {
		expect(entry).not.toContain(marker)
	})
})

describe(`${SKILL} — routes to the new entry point`, () => {
	const skill = read_unwrapped(SKILL)

	// `workflow-skills.test.ts` requires every shipped markdown file to be named by the entry file;
	// this asserts the routing row itself, which is what a run actually follows.
	it('carries a read-first row for the keyword', () => {
		expect(skill).toContain(`| \`${KEYWORD}\` | \`backlogrun.md\` + \`epicrun.md\``)
	})

	it('names the keyword in the explicit-invocation rule', () => {
		expect(skill).toContain(INVOCATION_RULE_MARKER)
	})

	// The hold is claimed per child at every batch entry point. Left out, a `backlogrun` child would
	// start on a tree another run is holding.
	it('counts the keyword among the batch entry points that claim per child', () => {
		expect(skill).toContain('`epicrun`, `queue` and `backlogrun` never call it')
	})
})

describe.each(AI_DOCS)('%s — keeps the keyword resident', (document_path) => {
	const document = read_unwrapped(document_path)

	it('lists the keyword among the Issue-driven shorthand commands', () => {
		expect(document).toContain('`queue`, `epicrun` and `backlogrun` are the Issue-driven shorthand')
	})

	it('carries a shorthand-table row for the keyword', () => {
		expect(document).toContain(`| \`${KEYWORD}\` | Run the opted-in backlog unattended`)
	})

	it('includes the keyword in the explicit-invocation rule', () => {
		expect(document).toContain(INVOCATION_RULE_MARKER)
	})
})

describe(`${COMMAND_DOC} — names the entry point that consumes the answer`, () => {
	const command_document = read_unwrapped(COMMAND_DOC)

	it('points from the command to the keyword that runs it', () => {
		expect(command_document).toContain(
			`**The entry point that consumes this answer is \`${KEYWORD}\`**`,
		)
		expect(command_document).toContain(ENTRY_SKILL)
	})
})
