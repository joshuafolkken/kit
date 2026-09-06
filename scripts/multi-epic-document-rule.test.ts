import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1493: the lane pool takes children from more than one epic. Four things can rot
// independently once the code is in — the entry grammar can go back to naming one epic, the decided
// priority order can lose its rationale and become "whatever the loop happened to do", the
// distinction from `queue #N1 #N2 …` can be dropped and leave two keywords reading the same, and the
// once-per-repository property of `pnpm josh latest` can be quietly re-read as once per epic. Each
// is pinned here.

const EPICRUN = '.claude/skills/workflow-commands/epicrun.md'
const EPIC_COMMANDS = '.claude/skills/epic-commands/SKILL.md'
const COMMAND_DOC = 'docs/josh-commands.md'
const POINTER = 'prompts/collaboration-workflow/epicrun.md'

// Every document a person reads before typing the keyword or the command.
const DOCUMENTS: ReadonlyArray<string> = [EPICRUN, EPIC_COMMANDS, COMMAND_DOC]

describe('the entry grammar takes more than one epic', () => {
	it('epicrun states the multi-epic form', () => {
		expect(read_unwrapped(EPICRUN)).toContain('epicrun #E1 #E2')
	})

	it.each(DOCUMENTS)('%s shows epic:next taking two references', (document_path) => {
		expect(read_repo_file(document_path)).toContain('858 909')
	})

	it('the command reference shows it beside --repo and --lanes', () => {
		expect(read_repo_file(COMMAND_DOC)).toContain(
			'pnpm josh epic:next 858 909 --repo joshuafolkken/kit --lanes',
		)
	})
})

// The order is a decision, and a decision with no recorded rationale is re-opened by whoever next
// wonders why depth was not used.
describe('the priority order is stated with its rationale', () => {
	it.each(DOCUMENTS)('%s names the order', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('the order the epics were named')
	})

	it.each(DOCUMENTS)('%s says why depth was rejected', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('depth')
	})

	// The counter-claim that keeps the change small: an epic's own chain is untouched.
	it.each([EPICRUN, EPIC_COMMANDS])('%s says nothing moves inside one epic', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('Inside one epic nothing moves')
	})
})

describe('a child two epics both track enters once', () => {
	it.each(DOCUMENTS)('%s says it is entered once', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('two epics both track')
	})

	// Keyed by repository and number, because a bare number names a different issue elsewhere.
	it.each(DOCUMENTS)('%s names the identity key', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('owner/repo#number')
	})
})

// `queue #N1 #N2 …` already means "these issues, in the order I typed, stopping at the first
// failure". Left unsaid, `epicrun #E1 #E2` reads as a second spelling of it — and a person expecting
// the serial semantics would be surprised by a park where they expected a stop.
describe('epicrun with several epics is distinguished from queue', () => {
	it('names queue in the comparison', () => {
		expect(read_unwrapped(EPICRUN)).toContain('queue #N1 #N2')
	})

	it('refuses the sequential reading outright', () => {
		expect(read_unwrapped(EPICRUN)).toContain('is **not** "run 858 to completion, then 909"')
	})

	it('says a stop parks the child rather than ending the session', () => {
		expect(read_unwrapped(EPICRUN)).toContain('Parks that child; the run continues')
	})
})

// The hoist is keyed to the session and the checkout, so nothing about it changes — which is exactly
// why it has to be said: an unstated invariant is one a later reader re-derives from the new shape.
describe('the dependency update stays once per repository', () => {
	it('epicrun says the number of epics does not change it', () => {
		expect(read_unwrapped(EPICRUN)).toContain('five epics')
	})

	it('epicrun keys the hoist to the session and the checkout, not an epic', () => {
		expect(read_unwrapped(EPICRUN)).toContain('never to an epic')
	})

	it('the command reference says epic:next does not affect it', () => {
		expect(read_repo_file(COMMAND_DOC)).toContain('`pnpm josh latest` is unaffected')
	})
})

// The two behaviors a reader would otherwise get wrong: which read failure stops the command, and
// which token says an epic is finished.
describe('what a multi-epic answer does not say', () => {
	it.each([EPICRUN, COMMAND_DOC])('%s says a childless epic is skipped', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('childless epic is skipped')
	})

	it('epicrun says the pooled token is about the pool', () => {
		expect(read_unwrapped(EPICRUN)).toContain('the pooled token does not say when')
	})

	it.each([EPICRUN, COMMAND_DOC])(
		'%s routes per-epic completion to the aggregate form',
		(document_path) => {
			expect(read_unwrapped(document_path)).toContain('only once every named epic is')
		},
	)
})

// The pointer records where the rule lives, never the rule itself.
describe('the pointer topic indexes the new section', () => {
	it('names the multi-epic entry', () => {
		expect(read_repo_file(POINTER)).toContain('joshuafolkken/kit#1493')
	})

	it('still routes to the skill rather than restating it', () => {
		expect(read_repo_file(POINTER)).toContain(EPICRUN)
	})
})
