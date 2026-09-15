import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

// joshuafolkken/kit#2030: the three static-check caches must save a fresh entry on every run so they
// track `main` rather than freezing on the first commit that hit a content-hash key and never
// re-saving. The shape that does it is a `${{ github.sha }}` tail on the key, with the sha-less
// prefix leading `restore-keys` — so the newest previous entry is restored and a new one is always
// saved. Asserted on the parsed cache step rather than the file's text, so a key that regressed
// while its comment still read correctly fails here instead of asserting the comment.
const STATIC_CHECKS_JOB = 'static-checks'
const SHA_SUFFIX = '-${{ github.sha }}'

interface CacheCase {
	step_id: string
	path: string
}

const CACHE_CASES: ReadonlyArray<CacheCase> = [
	{ step_id: 'eslint-cache', path: '.eslintcache' },
	{ step_id: 'tsbuildinfo-cache', path: '.tsbuildinfo' },
	{ step_id: 'cspell-cache', path: '.cspellcache' },
]

function cache_step(step_id: string): ReturnType<typeof ci_yml_fixture.find_step_by_id> {
	const job = ci_yml_fixture.find_job(ci_yml_fixture.RUNTIME_CI_YML, STATIC_CHECKS_JOB)

	return ci_yml_fixture.find_step_by_id(job, step_id)
}

function cache_input(step_id: string, key: string): string {
	return String(cache_step(step_id)?.with?.[key] ?? '')
}

describe.each(CACHE_CASES)(
	'static-check cache saves fresh every run ($step_id)',
	({ step_id, path }) => {
		// The lookups above return the empty string for a step that is not there, which would let the two
		// assertions below pass on a job that had lost the cache entirely.
		it('caches the file the gate writes at the repo root', () => {
			expect(cache_input(step_id, 'path')).toContain(path)
		})

		it('keys the cache on the commit sha so a fresh entry is saved every run', () => {
			expect(cache_input(step_id, 'key').endsWith(SHA_SUFFIX)).toBe(true)
		})

		it('restores the newest previous entry via the sha-less prefix', () => {
			const prefix = cache_input(step_id, 'key').slice(0, -SHA_SUFFIX.length)

			expect(prefix).not.toBe('')
			expect(cache_input(step_id, 'restore-keys')).toContain(prefix)
		})
	},
)
