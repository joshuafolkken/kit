import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	CANONICAL_DOC,
	POINTER_DOCS,
	read_repo_file,
	read_unwrapped,
} from './ai-document-fixture'
import { document_section } from './document-section'

// The rules live in one document; `AGENTS.md`, `GEMINI.md` and `.cursorrules` point at it
// (joshuafolkken/kit#963, joshuafolkken/kit#3249). Every other marker suite now reads `CLAUDE.md` alone, so nothing else
// would notice a rule being pasted back into a pointer — or a pointer quietly losing the sentence
// that sends an agent to the rules. This suite is what notices.

// Far under the resident ceiling the rule document is held to. A pointer that grew past this is not
// a pointer any more, which is the failure mode worth catching: rules creep back one paragraph at a
// time, and each paragraph looks reasonable on its own.
const POINTER_CEILING_BYTES = 4000

// Phrases that only ever appear in a rule body. Chosen from the sections that would be copied back
// first — the conventions and the gate — rather than from prose a pointer might legitimately quote.
const RULE_BODY_MARKERS: ReadonlyArray<string> = [
	'## Critical Conventions',
	'## Completion gate',
	'## Code Change Rules',
	'Function complexity ≤5',
	'pnpm josh gate',
]

const READ_IN_FULL = 'Read it in full'
const DO_NOT_COPY = 'Do not copy rules back into this file'

// joshuafolkken/kit#3079: how another agent reads `CLAUDE.md`'s Claude Code features lives once, in
// this section, and the list of hook-delivered rules it applies by hand is the delivery table — never
// a hand-written copy in a pointer, which drifted from the table the moment a rule was added.
const READING_DOC = 'prompts/collaboration-workflow/principles.md'
const READING_SECTION = 'Claude Code 以外のエージェントでの読み替え'
const ARRANGEMENT_SECTION = 'エージェント規則の単一ソースは `CLAUDE.md`'
const DELIVERY_TABLE_DOC = 'rule-delivery.md'
const DELIVERY_TABLE_SECTION = '配送されている規則'
const OFF_TABLE_HOOK_MARKERS: ReadonlyArray<string> = [
	'Step 0',
	'pnpm josh lint:related',
	'pnpm josh cspell:dot',
	'JOSH_SESSION_LANG',
]
// A hand-written rule list names the commands it tells the reader to run.
const JOSH_COMMAND = 'pnpm josh '

// The sentences every pointer is required to carry, pinned by the suite below. Identical text there
// is the pointer contract, not a clone; any other sentence two pointers share is.
const CONTRACT_PHRASES: ReadonlyArray<string> = [
	'All rules for this repository live in',
	READ_IN_FULL,
	'This file exists only to point at it',
	DO_NOT_COPY,
	'Every change to how agents work',
]

function sentences_of(document_path: string): ReadonlyArray<string> {
	return read_repo_file(document_path)
		.replaceAll(/[#*>]/gu, ' ')
		.split(/(?<=\.)\s+/u)
		.map((sentence) => sentence.replaceAll(/\s+/gu, ' ').trim())
		.filter((sentence) => sentence.length > 0)
}

function is_contract(sentence: string): boolean {
	return CONTRACT_PHRASES.some((phrase) => sentence.includes(phrase))
}

// Every pair of pointers, not the first against the rest: a sentence pasted into two of three
// pointers must fail here whichever two they are.
function shared_sentences(): ReadonlyArray<string> {
	const sentences = POINTER_DOCS.flatMap((document_path) => [
		...new Set(sentences_of(document_path)),
	])

	return [...new Set(sentences.filter((sentence, index) => sentences.indexOf(sentence) !== index))]
}

describe('the rules have exactly one home', () => {
	it('names only the canonical document', () => {
		expect(AI_DOCS).toStrictEqual([CANONICAL_DOC])
	})

	it('does not count a pointer as a rule document', () => {
		for (const pointer of POINTER_DOCS) expect(AI_DOCS).not.toContain(pointer)
	})
})

describe.each(POINTER_DOCS)('%s — points at the rules instead of copying them', (document_path) => {
	const content = read_repo_file(document_path)
	const unwrapped = read_unwrapped(document_path)

	it('names the canonical document', () => {
		expect(unwrapped).toContain(CANONICAL_DOC)
	})

	// A pointer that merely mentions the file is not a pointer. The instruction is what makes an
	// agent open it before acting rather than after it has already guessed.
	it('tells the reader to read it in full before working', () => {
		expect(unwrapped).toContain(READ_IN_FULL)
	})

	it('stays small enough that nobody mistakes it for the rules', () => {
		expect(Buffer.byteLength(content, 'utf8')).toBeLessThan(POINTER_CEILING_BYTES)
	})

	// Matched against the unwrapped text, not the raw file. The pointers are wrapped at 100 columns,
	// so a rule body pasted back in would have its markers split across line breaks — and a guard
	// that misses exactly the case it exists to catch is worse than none, because it reports clean.
	it.each(RULE_BODY_MARKERS)('carries no rule body — %s', (marker) => {
		expect(unwrapped).not.toContain(marker)
	})

	// The prohibition is in the file itself, because the next agent to add a rule reads this file
	// before it reads any test.
	it('says not to copy rules back into it', () => {
		expect(unwrapped).toContain(DO_NOT_COPY)
	})

	// joshuafolkken/kit#2894: the explanation of why this file is a pointer lives once, in
	// `docs/maintainers/principles-rationale.md`. A copy here is the clone this suite exists to stop.
	it('carries no copy of the pointer rationale', () => {
		expect(unwrapped).not.toContain('## Why this file is a pointer')
	})

	it('carries no hand-written list of rules to apply by hand', () => {
		expect(unwrapped).not.toContain(JOSH_COMMAND)
	})

	it('sends the reader to the shared reading section', () => {
		expect(unwrapped).toContain(READING_DOC)
		expect(unwrapped).toContain(READING_SECTION)
	})
})

describe('the pointers share nothing but their contract', () => {
	it('carries no common sentence outside the pointer contract', () => {
		expect(shared_sentences().filter((sentence) => !is_contract(sentence))).toStrictEqual([])
	})
})

describe('the reading section is the single home of the shared readings', () => {
	const found = document_section.section(read_repo_file(READING_DOC), READING_SECTION)

	it('exists under the heading the pointers name', () => {
		expect(found?.title).toBe(READING_SECTION)
	})

	it('takes its list of hook-delivered rules from the delivery table', () => {
		expect(found?.text).toContain(DELIVERY_TABLE_DOC)
		expect(found?.text).toContain(DELIVERY_TABLE_SECTION)
	})

	// The table enumerates the guard-delivered rules only; the format-on-edit hook and the Step 0
	// notice have no row there, and a hookless agent that read the table alone would lose both.
	it.each(OFF_TABLE_HOOK_MARKERS)('names the off-table hook duty — %s', (marker) => {
		expect(found?.text).toContain(marker)
	})
})

describe('the canonical document carries the rules', () => {
	const unwrapped = read_unwrapped(CANONICAL_DOC)

	it('still carries the rule bodies', () => {
		for (const marker of RULE_BODY_MARKERS) expect(unwrapped).toContain(marker)
	})

	// The old rule said to write every change three times. Leaving it in place would send the next
	// agent to re-clone the documents this Issue just un-cloned.
	it('no longer calls the three documents paired', () => {
		expect(unwrapped).not.toContain('are paired documents')
	})
})

// joshuafolkken/kit#3395 dropped the resident blockquote that restated the arrangement; it is
// explained once, in the principles section a reader of any pointer reaches.
describe(`${READING_DOC} explains the arrangement`, () => {
	const found = document_section.section(read_repo_file(READING_DOC), ARRANGEMENT_SECTION)

	it('names every pointer document so the arrangement is discoverable', () => {
		for (const pointer of POINTER_DOCS) expect(found?.text).toContain(pointer)
	})

	it('says the rules live in one place', () => {
		expect(found?.text).toContain('規則の本体は `CLAUDE.md` にしか無い')
	})
})
