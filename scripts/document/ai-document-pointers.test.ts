import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	CANONICAL_DOC,
	POINTER_DOCS,
	read_repo_file,
	read_unwrapped,
} from './ai-document-fixture'

// The rules live in one document; `AGENTS.md` and `GEMINI.md` point at it
// (joshuafolkken/kit#963). Every other marker suite now reads `CLAUDE.md` alone, so nothing else
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
		expect(unwrapped).toContain('Do not copy rules back into this file')
	})
})

describe('the canonical document explains the arrangement', () => {
	const content = read_repo_file(CANONICAL_DOC)
	const unwrapped = read_unwrapped(CANONICAL_DOC)

	it('still carries the rule bodies', () => {
		for (const marker of RULE_BODY_MARKERS) expect(unwrapped).toContain(marker)
	})

	it('names both pointer documents so the arrangement is discoverable', () => {
		for (const pointer of POINTER_DOCS) expect(content).toContain(pointer)
	})

	// The old rule said to write every change three times. Leaving it in place would send the next
	// agent to re-clone the documents this Issue just un-cloned.
	it('no longer calls the three documents paired', () => {
		expect(unwrapped).not.toContain('are paired documents')
	})

	it('says a rule change lands in one place', () => {
		expect(unwrapped).toContain('single source')
	})
})
