import { describe, expect, it } from 'vitest'
import { release_history, type HistoryReader } from './release-history'

const CURRENT = '1.339.0'
const PREVIOUS = '1.338.0'
const THREE = 3
const BASE_SHA = 'base'

function manifest(version: string): string {
	return JSON.stringify({ name: '@joshuafolkken/kit', version })
}

// `git show <ref>:package.json` answers per revision, so the fake is keyed the same way and throws
// for a revision it does not know — exactly as git does for a path absent at that revision.
function reader_for(input: {
	shas: Array<string>
	manifests: Map<string, string>
	merges?: number
}): HistoryReader {
	return {
		log_first_parent: async () => input.shas,
		show_file: async (spec) => {
			const found = input.manifests.get(spec)

			if (found === undefined) throw new Error(`no such path: ${spec}`)

			return found
		},
		count_merges: async () => input.merges ?? 0,
	}
}

// `./` matches what `read_version_at` asks git for — cwd-relative, so it agrees with the
// `git log -- package.json` that produced the revisions.
function manifests_of(entries: Array<[string, string]>): Map<string, string> {
	return new Map(
		entries.map(([reference, version]) => [`${reference}:./package.json`, manifest(version)]),
	)
}

function plan_reader(merges: number): HistoryReader {
	return reader_for({
		shas: [BASE_SHA],
		manifests: manifests_of([
			[BASE_SHA, CURRENT],
			[`${BASE_SHA}^`, PREVIOUS],
		]),
		merges,
	})
}

describe('release_history.parse_version', () => {
	it('reads the version out of a package.json blob', () => {
		expect(release_history.parse_version(manifest(CURRENT))).toBe(CURRENT)
	})

	it('answers undefined for a blob it cannot read as a package.json', () => {
		expect(release_history.parse_version('not json')).toBeUndefined()
		expect(release_history.parse_version('{}')).toBeUndefined()
		expect(release_history.parse_version(undefined)).toBeUndefined()
	})
})

describe('release_history.read_base', () => {
	it('finds the newest commit that moved the version', async () => {
		const reader = reader_for({
			shas: ['c3', 'c2'],
			manifests: manifests_of([
				['c3', CURRENT],
				['c2', PREVIOUS],
				['c2^', '1.337.0'],
			]),
		})

		expect(await release_history.read_base(reader)).toBe('c3')
	})

	it('walks past commits that touched package.json without moving the version', async () => {
		const reader = reader_for({
			shas: ['deps', 'release'],
			manifests: manifests_of([
				['deps', CURRENT],
				['release', CURRENT],
				['release^', PREVIOUS],
			]),
		})

		expect(await release_history.read_base(reader)).toBe('release')
	})

	it('answers undefined when no commit in range moved the version', async () => {
		const reader = reader_for({ shas: [], manifests: new Map() })

		expect(await release_history.read_base(reader)).toBeUndefined()
	})
})

describe('release_history.read_release_plan', () => {
	it('raises the version by one minor per merge since the base', async () => {
		const plan = await release_history.read_release_plan(CURRENT, plan_reader(THREE))

		expect(plan?.base).toBe(BASE_SHA)
		expect(plan?.pending).toBe(THREE)
		expect(plan?.next_version).toBe('1.342.0')
	})

	it('reports zero pending merges rather than proposing a version', async () => {
		const plan = await release_history.read_release_plan(CURRENT, plan_reader(0))

		expect(plan?.pending).toBe(0)
		expect(plan?.next_version).toBe(CURRENT)
	})

	it('answers undefined when the base could not be found', async () => {
		const plan = await release_history.read_release_plan(
			CURRENT,
			reader_for({ shas: [], manifests: new Map() }),
		)

		expect(plan).toBeUndefined()
	})
})
