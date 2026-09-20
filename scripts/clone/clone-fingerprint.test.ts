import { describe, expect, it } from 'vitest'
import { clone_fingerprint, type FileSite } from './clone-fingerprint'

// joshuafolkken/kit#2217: fingerprinting is what lets two copies match after they have been
// reindented or re-commented, so the normalization and the sliding window are pinned here.

const SITE: FileSite = { repo: '/repos/a', file: 'scripts/one.ts' }
const FIRST_LINE = 'const a = 1'
const BLANK_LINE = ' '.repeat(3)
const INDENT = '\t'.repeat(2)

// Seven significant lines: enough to fill one block, with a remainder the stride leaves out.
const BLOCK = [
	FIRST_LINE,
	'const b = 2',
	'const c = 3',
	'const d = 4',
	'const e = 5',
	'const f = 6',
	'const g = 7',
].join('\n')

describe('normalize erases formatting differences', () => {
	it('collapses interior and edge whitespace', () => {
		expect(clone_fingerprint.normalize('  const   a =\t1  ')).toBe(FIRST_LINE)
	})
})

describe('is_significant drops blank and comment-only lines', () => {
	it('rejects a blank line', () => {
		expect(clone_fingerprint.is_significant(BLANK_LINE)).toBe(false)
	})

	it('rejects a comment line', () => {
		expect(clone_fingerprint.is_significant('  // a note')).toBe(false)
	})

	it('accepts a code line', () => {
		expect(clone_fingerprint.is_significant(FIRST_LINE)).toBe(true)
	})
})

describe('significant_lines keeps original line numbers', () => {
	it('tags surviving lines with their 1-based source position', () => {
		const lines = clone_fingerprint.significant_lines(`\n// note\n${FIRST_LINE}\n`)

		expect(lines).toEqual([{ text: FIRST_LINE, number: 3 }])
	})
})

describe('fingerprints_for windows the significant lines', () => {
	it('yields nothing below the window size', () => {
		expect(clone_fingerprint.fingerprints_for(FIRST_LINE, SITE)).toHaveLength(0)
	})

	it('matches an identical block after reindentation', () => {
		const original = clone_fingerprint.fingerprints_for(BLOCK, SITE)
		const reindented = clone_fingerprint.fingerprints_for(
			BLOCK.split('\n')
				.map((line) => `${INDENT}${line}`)
				.join('\n'),
			SITE,
		)

		expect(reindented[0]?.hash).toBe(original[0]?.hash)
	})

	it('differs when the code differs', () => {
		const original = clone_fingerprint.fingerprints_for(BLOCK, SITE)
		const changed = clone_fingerprint.fingerprints_for(
			BLOCK.replaceAll(FIRST_LINE, 'const a = 9'),
			SITE,
		)

		expect(changed[0]?.hash).not.toBe(original[0]?.hash)
	})
})
