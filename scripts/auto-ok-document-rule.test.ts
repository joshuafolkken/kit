import { describe, expect, it } from 'vitest'
import { read_repo_file, read_unwrapped } from './ai-document-fixture'
import { AUTO_OK_LABEL } from './git/issue-labels'
import { COMMAND_MAP } from './josh/josh-command-map'

// joshuafolkken/kit#906: `auto-ok` is what lets an unattended run reach an issue no epic tracks, so
// every load-bearing part of it is a sentence somebody could reword away — who may apply the label,
// when the pickup happens, in what order, and the cap on it. A document that keeps the label and
// drops any one of them describes a run that either widens its own authorization or never picks
// anything up.
//
// **The canonical corpus is no longer one of the documents checked** (joshuafolkken/kit#1188). Every
// marker below used to be asserted twice — once against the skill and once against the Japanese
// `prompts/collaboration-workflow/epicrun.md` — which is the duplication joshuafolkken/kit#1176 is
// removing: the canonical topic file is now a pointer and holds no body to assert against. That the
// pointer stays a pointer, and that what it used to carry reached the skill, is
// `epicrun-document-rule.test.ts`'s job; this suite asserts the surface the rule actually lives on.

const SKILL = '.claude/skills/workflow-commands/epicrun.md'
const COMMAND_DOC = 'docs/josh-commands.md'
const COMMAND_NAME = 'auto-ok:next'
const COMMAND = `pnpm josh ${COMMAND_NAME}`
const EVERY_DOCUMENT: ReadonlyArray<string> = [SKILL, COMMAND_DOC]

describe('the label name is single-sourced in code', () => {
	it('is registered as a constant, not written into a document as a bare string', () => {
		expect(read_repo_file('scripts/git/issue-labels.ts')).toContain(`= '${AUTO_OK_LABEL}'`)
	})

	// The whole reason the pickup is a command: an agent told to type `gh issue list --label auto-ok`
	// carries a second copy of the name in prose, where nothing checks it against the constant.
	it('routes the pickup through the command', () => {
		expect(read_unwrapped(SKILL)).toContain(COMMAND)
	})

	it('registers the command so the documents can name it', () => {
		expect(Object.keys(COMMAND_MAP)).toContain(COMMAND_NAME)
	})
})

// The decision this issue had to make, and the one an unattended run cannot be left to re-derive.
const OPT_IN_MARKERS: ReadonlyArray<[string, string]> = [
	[SKILL, '**Only a person applies `auto-ok`. Never apply it on your own judgement.**'],
	[COMMAND_DOC, '**Only a person applies `auto-ok`.**'],
]

describe('who may opt an issue in', () => {
	it.each(OPT_IN_MARKERS)('%s says the label is a person’s act', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})

	// Without this the rule reads as "never touch the label", and an agent refuses an explicit
	// instruction — the opposite failure, and one that costs the person the only way to opt in.
	it('separates deciding from typing', () => {
		expect(read_unwrapped(SKILL)).toContain('Typing the command for the person is not applying it')
	})

	// The argument, not just the conclusion: a rule whose reason is gone is the first one reworded.
	it('says why an agent-applied label would be no guard', () => {
		expect(read_unwrapped(SKILL)).toContain('widen its own authorization')
	})
})

describe('when the pickup happens', () => {
	it('pins it to the end of the epic', () => {
		expect(read_unwrapped(SKILL)).toContain(
			"The pickup happens once the epic's children are done, and nowhere else.",
		)
	})

	// `stop` is the verdict a pickup would paper over: the epic needs a person, and doing unrelated
	// work instead buries that behind a wall of merged PRs.
	it('refuses to pick up on stop', () => {
		expect(read_unwrapped(SKILL)).toContain('**No pickup** — the epic needs a person')
	})
})

describe('the order the pickup runs in', () => {
	it.each([
		[SKILL, '**The order is the one the person was just shown.**'],
		[COMMAND_DOC, 'newest first, skipping `epic`, `in-progress` and `needs-decision`'],
	])('%s states it', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})
})

// Pinned with the row text rather than the bare number: a lone `5` appears throughout these
// documents and would keep this green after the whole row was deleted.
describe('the cap on a single run', () => {
	it('carries it as a row of the guards table', () => {
		expect(read_repo_file(SKILL)).toContain('| `auto-ok` issues per run | 5 |')
	})
})

describe('opting in is the default absence', () => {
	it.each([
		[SKILL, 'the run finishes exactly as it did before this section existed'],
		[COMMAND_DOC, '**Opting in is the default absence.**'],
	])('%s says an unlabelled backlog changes nothing', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})
})

// A listing that could not be read is the failure this codebase has already shipped twice
// (joshuafolkken/kit#950, #973). It must not read as "nothing is opted in".
describe('a listing that could not be read', () => {
	it.each(EVERY_DOCUMENT)('%s tells it apart from none', (document_path) => {
		expect(read_unwrapped(document_path)).toMatch(
			/is not `none`|`none` ではない|not\*\* the same as `none`/u,
		)
	})
})
