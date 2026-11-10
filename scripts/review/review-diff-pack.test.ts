import { describe, expect, it } from 'vitest'
import { review_diff_pack, type PathParts } from './review-diff-pack'
import { review_diff_parts } from './review-diff-parts'

// joshuafolkken/kit#7044: the reviewer Reads every part file, so consecutive parts share a file while
// it fits the cap — and the files still join back to exactly the parts, so the review's scope is
// the same and only the number of reads drops.

const CAP = 200
const SMALL = 'x'.repeat(20)
const LARGE = Array.from({ length: 20 }, (_, index) => `+line ${String(index)}\n`).join('')

function entry(relative: string, diff: string): PathParts {
	return { relative, parts: review_diff_parts.part_texts(relative, diff, CAP) }
}

const ENTRIES: ReadonlyArray<PathParts> = [
	entry('a.ts', `${SMALL}\n`),
	entry('b.ts', `${SMALL}\n`),
	entry('c.ts', LARGE),
	entry('d.ts', `${SMALL}\n`),
]

describe('review_diff_pack.pack — fewer files, the same text', () => {
	it('puts small consecutive paths into one file', () => {
		const [first] = review_diff_pack.pack(ENTRIES, CAP)

		expect(first?.paths.slice(0, 2)).toStrictEqual(['a.ts', 'b.ts'])
	})

	it('writes fewer files than parts', () => {
		const part_count = ENTRIES.flatMap((path_parts) => path_parts.parts).length

		expect(review_diff_pack.pack(ENTRIES, CAP).length).toBeLessThan(part_count)
	})

	it('keeps every file within the cap', () => {
		for (const bundle of review_diff_pack.pack(ENTRIES, CAP)) {
			expect(bundle.text.length).toBeLessThanOrEqual(CAP)
		}
	})

	it('joins back to exactly the parts in order', () => {
		const joined = review_diff_pack
			.pack(ENTRIES, CAP)
			.map((bundle) => bundle.text)
			.join('')

		expect(joined).toBe(ENTRIES.flatMap((path_parts) => path_parts.parts).join(''))
	})

	it('names every path in the files that carry it', () => {
		const named = review_diff_pack.pack(ENTRIES, CAP).flatMap((bundle) => bundle.paths)

		expect(new Set(named)).toStrictEqual(new Set(['a.ts', 'b.ts', 'c.ts', 'd.ts']))
	})
})

describe('review_diff_pack.parts_of — each path to the files holding its parts', () => {
	it('lists a shared file under every path it carries, in order', () => {
		const shared = '/p/000.diff'
		const next = '/p/001.diff'
		const written = [
			{ file: shared, paths: ['a.ts', 'b.ts'] },
			{ file: next, paths: ['b.ts'] },
		]

		expect(review_diff_pack.parts_of(written)).toStrictEqual({
			'a.ts': [shared],
			'b.ts': [shared, next],
		})
	})
})
