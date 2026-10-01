import { existsSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fresh_metadata_cache } from './fresh-metadata-cache'

const CACHE_DIRECTORY_FLAG = '--config.cache-dir='
const PNPM = 'pnpm'
const UPDATE = 'update'
const FIXTURE_DIRECTORY = 'cache-directory-fixture'
const STAGES = [
	[PNPM, UPDATE, '--latest'],
	[PNPM, UPDATE],
]

function cache_directory_of(stages: ReadonlyArray<ReadonlyArray<string>>): string {
	const flag = stages[0]?.find((argument) => argument.startsWith(CACHE_DIRECTORY_FLAG)) ?? ''

	return flag.slice(CACHE_DIRECTORY_FLAG.length)
}

function is_empty_directory(directory: string): boolean {
	return existsSync(directory) && readdirSync(directory).length === 0
}

describe('fresh_metadata_cache.with_cache_directory', () => {
	it('appends the cache-dir flag to every stage', () => {
		expect(fresh_metadata_cache.with_cache_directory(STAGES, FIXTURE_DIRECTORY)).toEqual([
			[PNPM, UPDATE, '--latest', `${CACHE_DIRECTORY_FLAG}${FIXTURE_DIRECTORY}`],
			[PNPM, UPDATE, `${CACHE_DIRECTORY_FLAG}${FIXTURE_DIRECTORY}`],
		])
	})
})

// Regression for joshuafolkken/kit#2805: metadata cached through safe-chain before a version aged
// in must never be read by a later run, so every run resolves against an empty, run-owned cache.
describe('fresh_metadata_cache.run_in_fresh_cache — the directory the stages see', () => {
	it('points every stage at the same directory', () => {
		const seen = fresh_metadata_cache.run_in_fresh_cache(STAGES, (stages) =>
			stages.map((stage) => cache_directory_of([stage])),
		)

		expect(seen).toHaveLength(STAGES.length)
		expect(new Set(seen).size).toBe(1)
	})

	it('hands the stages an empty directory', () => {
		const is_empty = fresh_metadata_cache.run_in_fresh_cache(STAGES, (stages) =>
			is_empty_directory(cache_directory_of(stages)),
		)

		expect(is_empty).toBe(true)
	})

	it('uses a different directory on each run', () => {
		const first = fresh_metadata_cache.run_in_fresh_cache(STAGES, cache_directory_of)
		const second = fresh_metadata_cache.run_in_fresh_cache(STAGES, cache_directory_of)

		expect(first).not.toBe(second)
	})
})

describe('fresh_metadata_cache.run_in_fresh_cache — cleanup', () => {
	it('returns the result of the stages and removes the directory afterwards', () => {
		const directory = fresh_metadata_cache.run_in_fresh_cache(STAGES, cache_directory_of)

		expect(directory.length).toBeGreaterThan(0)
		expect(existsSync(directory)).toBe(false)
	})

	it('removes the directory even when the stages throw', () => {
		let directory = ''

		expect(() =>
			fresh_metadata_cache.run_in_fresh_cache(STAGES, (stages) => {
				directory = cache_directory_of(stages)

				throw new Error('boom')
			}),
		).toThrow('boom')
		expect(existsSync(directory)).toBe(false)
	})
})
