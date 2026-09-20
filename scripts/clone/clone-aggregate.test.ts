import { describe, expect, it } from 'vitest'
import { clone_aggregate, type Fingerprint } from './clone-aggregate'

// joshuafolkken/kit#2217: the clone aggregation is the measurement the `no-clones` rule lacked, so
// the four outcomes it distinguishes — same-file, cross-file, cross-repository, and none — are each
// pinned here.

const REPO_A = '/repos/a'
const REPO_B = '/repos/b'
const FILE_ONE = 'scripts/one.ts'
const FILE_TWO = 'scripts/two.ts'
const DUPLICATE_HASH = 'dup'
const UNIQUE_HASH = 'uniq'
const SAME_FILE = 'same-file'
const CROSS_FILE = 'cross-file'
const CROSS_REPO = 'cross-repo'

function fingerprint(hash: string, repo: string, file: string, line: number): Fingerprint {
	return { hash, site: { repo, file, line } }
}

describe('categorize spans by the widest boundary the sites straddle', () => {
	it('is same-file when every site shares one file', () => {
		const sites = [
			{ repo: REPO_A, file: FILE_ONE, line: 1 },
			{ repo: REPO_A, file: FILE_ONE, line: 40 },
		]

		expect(clone_aggregate.categorize(sites)).toBe(SAME_FILE)
	})

	it('is cross-file when the sites share a repository but not a file', () => {
		const sites = [
			{ repo: REPO_A, file: FILE_ONE, line: 1 },
			{ repo: REPO_A, file: FILE_TWO, line: 1 },
		]

		expect(clone_aggregate.categorize(sites)).toBe(CROSS_FILE)
	})

	it('is cross-repo when the sites span two repositories', () => {
		const sites = [
			{ repo: REPO_A, file: FILE_ONE, line: 1 },
			{ repo: REPO_B, file: FILE_ONE, line: 1 },
		]

		expect(clone_aggregate.categorize(sites)).toBe(CROSS_REPO)
	})
})

describe('aggregate separates duplicated fingerprints from unique ones', () => {
	it('finds no clone when every fingerprint is unique', () => {
		const clones = clone_aggregate.aggregate([
			fingerprint(UNIQUE_HASH, REPO_A, FILE_ONE, 1),
			fingerprint('other', REPO_A, FILE_TWO, 1),
		])

		expect(clones).toHaveLength(0)
	})

	it('keeps every site of a clone in insertion order', () => {
		const clones = clone_aggregate.aggregate([
			fingerprint(DUPLICATE_HASH, REPO_A, FILE_ONE, 1),
			fingerprint(DUPLICATE_HASH, REPO_A, FILE_TWO, 5),
		])

		expect(clones[0]?.sites.map((site) => site.line)).toEqual([1, 5])
	})
})

describe('aggregate counts and classifies each clone', () => {
	it('counts a same-file clone', () => {
		const clones = clone_aggregate.aggregate([
			fingerprint(DUPLICATE_HASH, REPO_A, FILE_ONE, 1),
			fingerprint(DUPLICATE_HASH, REPO_A, FILE_ONE, 40),
		])

		expect(clones).toHaveLength(1)
		expect(clones[0]?.category).toBe(SAME_FILE)
	})

	it('counts a cross-file clone', () => {
		const clones = clone_aggregate.aggregate([
			fingerprint(DUPLICATE_HASH, REPO_A, FILE_ONE, 1),
			fingerprint(DUPLICATE_HASH, REPO_A, FILE_TWO, 1),
		])

		expect(clones).toHaveLength(1)
		expect(clones[0]?.category).toBe(CROSS_FILE)
	})

	it('counts a cross-repository clone', () => {
		const clones = clone_aggregate.aggregate([
			fingerprint(DUPLICATE_HASH, REPO_A, FILE_ONE, 1),
			fingerprint(DUPLICATE_HASH, REPO_B, FILE_ONE, 1),
		])

		expect(clones).toHaveLength(1)
		expect(clones[0]?.category).toBe(CROSS_REPO)
	})
})
