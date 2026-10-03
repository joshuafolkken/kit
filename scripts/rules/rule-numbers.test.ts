import { existsSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import {
	agent_read_documents,
	read_index,
	read_repo_file,
	read_unwrapped,
} from '#scripts/document/ai-document-fixture'
import { delivered_rules } from '#scripts/rules/delivered-rules'
import { split_assess } from '#scripts/split/split-assess'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2996: a rule number written in several documents drifts the moment one of them
// changes. Each number has one source in code, one document that states it, and every other document
// points at that document instead of restating it — so this suite pins both halves: the stating
// document agrees with the code, and the documents that used to restate it no longer do.

const WIP_CAP = String(delivered_rules.WIP_CAP)
const FILE_GUIDE = String(split_assess.FILE_GUIDE)
const LINE_GUIDE = String(split_assess.LINE_GUIDE)

const WIP_TOPIC = 'prompts/collaboration-workflow/wip-cap.md'
const SPLIT_SKILL = '.claude/skills/workflow-commands/split-assessment.md'
const REVIEW_PROMPT = 'prompts/review.md'
const OPERATING_RULES = 'prompts/collaboration-workflow/operating-rules.md'
const OVERVIEW = 'prompts/collaboration-workflow/overview.md'
const RESIDENCY = 'prompts/collaboration-workflow/residency.md'
// The review round cap's number lives in the heading of `review.md` alone.
const TWO_REVIEWS = 'two reviews'

// Every document an agent reads except the three that state a number, so a restatement added to any
// skill or topic file later is caught without someone remembering to list that file here.
const SOURCE_DOCUMENTS: ReadonlySet<string> = new Set([WIP_TOPIC, SPLIT_SKILL, REVIEW_PROMPT])
const POINTING_DOCUMENTS: ReadonlyArray<string> = agent_read_documents().filter(
	(document) => !SOURCE_DOCUMENTS.has(document),
)

const RESTATEMENTS: ReadonlyArray<string> = [
	`more than ${WIP_CAP} open`,
	`above ${WIP_CAP} open`,
	`cap of ${WIP_CAP}`,
	`${WIP_CAP} 件`,
	`about ${FILE_GUIDE} changed files`,
	`${LINE_GUIDE} changed lines`,
	TWO_REVIEWS,
]

// The pointer-only topic files, deleted because each said nothing but "the rule lives elsewhere".
const RETIRED_POINTERS: ReadonlyArray<string> = [
	'prompts/collaboration-workflow/cross-repo-epic.md',
	'prompts/collaboration-workflow/epic-audit.md',
	'prompts/collaboration-workflow/epic-bundle.md',
]

function standalone_count(content: string, value: string): number {
	return [...content.matchAll(new RegExp(String.raw`(?<!\d)${value}(?!\d)`, 'gu'))].length
}

describe('each rule number agrees with its source in code', () => {
	it('states the WIP cap in wip-cap.md as WIP_CAP', () => {
		expect(read_unwrapped(WIP_TOPIC)).toContain(`**上限は ${WIP_CAP}。**`)
	})

	it('states the split guide in split-assessment.md as FILE_GUIDE and LINE_GUIDE', () => {
		expect(read_unwrapped(SPLIT_SKILL)).toContain(
			`about ${FILE_GUIDE} changed files and about ${LINE_GUIDE} changed lines`,
		)
	})

	it('names the review round cap in the heading of review.md alone', () => {
		expect(read_repo_file(REVIEW_PROMPT)).toContain('## Review round cap (2 rounds)')
		expect(read_unwrapped(REVIEW_PROMPT)).not.toContain(TWO_REVIEWS)
	})
})

describe('each source document states its number once', () => {
	it('writes the WIP cap once in wip-cap.md', () => {
		expect(standalone_count(read_repo_file(WIP_TOPIC), WIP_CAP)).toBe(1)
	})

	it('writes the line guide once in split-assessment.md', () => {
		expect(standalone_count(read_repo_file(SPLIT_SKILL), LINE_GUIDE)).toBe(1)
	})
})

describe.each(POINTING_DOCUMENTS)(
	'%s — points at the number instead of restating it',
	(document) => {
		const content = read_unwrapped(document)

		it.each(RESTATEMENTS)('does not restate %j', (restatement) => {
			expect(content).not.toContain(restatement)
		})
	},
)

describe('the index and the deny list carry no second copy', () => {
	it('does not put the WIP cap in the index row', () => {
		expect(read_index()).not.toContain(`${WIP_CAP} 件`)
	})

	it('does not call the index the canonical source', () => {
		expect(read_index()).not.toContain('正典')
	})

	it('does not transcribe settings.json deny patterns into operating-rules.md', () => {
		expect(read_repo_file(OPERATING_RULES)).not.toContain('`Bash(')
	})
})

describe('no topic file keeps a competing claim to the source', () => {
	it('does not call overview.md the canonical detailed version the skill must match', () => {
		expect(read_unwrapped(OVERVIEW)).not.toContain('正典の詳細版')
	})

	it('does not tell residency.md readers to keep a pointer-only topic file', () => {
		expect(read_unwrapped(RESIDENCY)).not.toContain('話題ファイル自体は残す')
	})
})

describe.each(RETIRED_POINTERS)('%s — the pointer-only file is retired', (retired) => {
	it('no longer exists', () => {
		expect(existsSync(package_file(retired))).toBe(false)
	})

	it('is not linked from the index', () => {
		expect(read_index()).not.toContain(retired.replace('prompts/', './'))
	})
})
