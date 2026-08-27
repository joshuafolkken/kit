import { describe, expect, it } from 'vitest'
import { read_repo_file, read_unwrapped, WORKFLOW_PROMPT } from './ai-document-fixture'
import { AUTO_OK_LABEL } from './git/issue-labels'
import { COMMAND_MAP } from './josh/josh-command-map'

// joshuafolkken/kit#906: `auto-ok` is what lets an unattended run reach an issue no epic tracks, so
// every load-bearing part of it is a sentence somebody could reword away — who may apply the label,
// when the pickup happens, in what order, and the cap on it. A document that keeps the label and
// drops any one of them describes a run that either widens its own authorization or never picks
// anything up.

const SKILL = '.claude/skills/workflow-commands/epicrun.md'
const COMMAND_DOC = 'docs/josh-commands.md'
const COMMAND_NAME = 'auto-ok:next'
const COMMAND = `pnpm josh ${COMMAND_NAME}`
const EVERY_DOCUMENT: ReadonlyArray<string> = [SKILL, WORKFLOW_PROMPT, COMMAND_DOC]

describe('the label name is single-sourced in code', () => {
	it('is registered as a constant, not written into a document as a bare string', () => {
		expect(read_repo_file('scripts/git/issue-labels.ts')).toContain(`= '${AUTO_OK_LABEL}'`)
	})

	// The whole reason the pickup is a command: an agent told to type `gh issue list --label auto-ok`
	// carries a second copy of the name in prose, where nothing checks it against the constant.
	it.each([SKILL, WORKFLOW_PROMPT])('%s routes the pickup through the command', (document_path) => {
		expect(read_unwrapped(document_path)).toContain(COMMAND)
	})

	it('registers the command so the documents can name it', () => {
		expect(Object.keys(COMMAND_MAP)).toContain(COMMAND_NAME)
	})
})

// The decision this issue had to make, and the one an unattended run cannot be left to re-derive.
const OPT_IN_MARKERS: ReadonlyArray<[string, string]> = [
	[SKILL, '**Only a person applies `auto-ok`. Never apply it on your own judgement.**'],
	[WORKFLOW_PROMPT, '**`auto-ok` を付けるのは人だけである。AI が自分の判断で付けてはならない。**'],
	[COMMAND_DOC, '**Only a person applies `auto-ok`.**'],
]

describe('who may opt an issue in', () => {
	it.each(OPT_IN_MARKERS)('%s says the label is a person’s act', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})

	// Without this the rule reads as "never touch the label", and an agent refuses an explicit
	// instruction — the opposite failure, and one that costs the person the only way to opt in.
	it.each([
		[SKILL, 'Typing the command for the person is not applying it'],
		[WORKFLOW_PROMPT, '人の代わりに打鍵することは「AI が付ける」ことではない'],
	])('%s separates deciding from typing', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})

	// The argument, not just the conclusion: a rule whose reason is gone is the first one reworded.
	it.each([
		[SKILL, 'widen its own authorization'],
		[WORKFLOW_PROMPT, '無人ランが自分の承認範囲を自分で広げられる'],
	])('%s says why an agent-applied label would be no guard', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})
})

describe('when the pickup happens', () => {
	it.each([
		[SKILL, "The pickup happens once the epic's children are done, and nowhere else."],
		[WORKFLOW_PROMPT, '**拾い上げは EPIC の子を消化し終えた後だけに起こる。**'],
	])('%s pins it to the end of the epic', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})

	// `stop` is the verdict a pickup would paper over: the epic needs a person, and doing unrelated
	// work instead buries that behind a wall of merged PRs.
	it.each([
		[SKILL, '**No pickup** — the epic needs a person'],
		[WORKFLOW_PROMPT, '**拾い上げは行わない** — 人を要する状態を無関係な作業で埋没させない'],
	])('%s refuses to pick up on stop', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})
})

describe('the order the pickup runs in', () => {
	it.each([
		[SKILL, '**The order is the one the person was just shown.**'],
		[WORKFLOW_PROMPT, '**順序は、直前に人が見せられたものと同じである。**'],
		[COMMAND_DOC, 'newest first, skipping `epic`, `in-progress` and `needs-decision`'],
	])('%s states it', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})
})

// Pinned with the row text rather than the bare number: a lone `5` appears throughout these
// documents and would keep this green after the whole row was deleted.
describe('the cap on a single run', () => {
	it.each([
		[SKILL, '| `auto-ok` issues per run | 5 |'],
		[WORKFLOW_PROMPT, '| 1 ラン内の `auto-ok` 件数 | 5 件 |'],
	])('%s carries it as a row of the guards table', (document_path, marker) => {
		expect(read_repo_file(document_path)).toContain(marker)
	})
})

describe('opting in is the default absence', () => {
	it.each([
		[SKILL, 'the run finishes exactly as it did before this section existed'],
		[WORKFLOW_PROMPT, '**オプトインが無いことが既定である。**'],
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
