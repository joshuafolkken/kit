import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#926: an interrupted run leaves a working tree nobody was looking at, and the
// reclaim rule is only a rule where a run can read it. Three surfaces have to state it — the loop
// that asks the command, the command reference, and the enumeration that authorizes the one
// automatic `git stash` it prescribes — so each is pinned here rather than left to survive an edit
// by luck. The model is `worktree-hold-document-rule.test.ts`, for its sibling command.

const EPICRUN = '.claude/skills/workflow-commands/epicrun.md'
const DOCS = 'docs/josh-commands.md'
const OPERATING_RULES = 'prompts/collaboration-workflow/operating-rules.md'

const COMMAND = 'run:preflight'
const ALIAS = 'rp'
const SCRIPT_PATH = 'scripts/run/run-preflight-cli.ts'

const SECTION_POINTER =
	'Preflight — reclaim what an interrupted run left, before the next child starts'
const REUSE_RULE = 'run the whole verification gate from the start'

// The four states the issue named, plus the two rules that make the answers usable: the fixed
// precedence, and that the command may be asked again.
const EPICRUN_MARKERS: ReadonlyArray<string> = [
	SECTION_POINTER,
	'pnpm josh run:preflight',
	'`reclaim`',
	'`resume`',
	'`park`',
	'`clean`',
	'git stash push -u -m "run:preflight reclaimed before #<N>"',
	'**`-u` is not optional**',
	REUSE_RULE,
	'nobody had verified what the dead run already committed',
	'record the stash on `#<N>` as a comment, and ask again',
	'It is not `run:hold`, and neither replaces the other.',
	'Report what was reclaimed.',
]

const DOCS_MARKERS: ReadonlyArray<string> = [
	'### `josh run:preflight`',
	'alias: josh rp',
	'The precedence between those states is fixed',
	'It is re-askable, which `josh run:hold` deliberately is not.',
	'the one sanctioned stash that is never popped',
	'The pull request is reached through its head branch, which is the limit of what this command sees.',
	'An unreadable `gh` is never read as an absent pull request',
	REUSE_RULE,
	SECTION_POINTER,
]

const OPERATING_RULES_MARKERS: ReadonlyArray<string> = [
	'`epicrun` の子を始める前の preflight',
	'pnpm josh run:preflight <N>',
	'joshuafolkken/kit#926',
	'**この 5 番目だけが `git stash pop` を伴わない。前の 4 つはいずれも直後に `git stash pop` で復元することが手順に含まれている。**',
	'その記録だけが後で pop させられる唯一の手がかり',
]

describe(`${EPICRUN} — the loop states the reclaim procedure`, () => {
	const content = read_unwrapped(EPICRUN)

	it.each(EPICRUN_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('asks the command before the child is started', () => {
		expect(content).toContain('first ask `pnpm josh run:preflight <N>` and obey it')
	})
})

describe(`${DOCS} — the command reference documents the behavior`, () => {
	const content = read_unwrapped(DOCS)

	it.each(DOCS_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${OPERATING_RULES} — the stash enumeration carries the new flow`, () => {
	const content = read_unwrapped(OPERATING_RULES)

	it.each(OPERATING_RULES_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe('the command is registered', () => {
	it('runs the preflight script', () => {
		expect(COMMAND_MAP[COMMAND]?.script).toBe(SCRIPT_PATH)
	})

	it('takes no default arguments, unlike the shared run:hold script', () => {
		expect(COMMAND_MAP[COMMAND]?.default_script_arguments).toBeUndefined()
	})

	it(`resolves the alias ${ALIAS}`, () => {
		expect(ALIASES[ALIAS]).toBe(COMMAND)
	})
})
