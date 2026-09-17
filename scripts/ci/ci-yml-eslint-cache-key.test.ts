import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

// joshuafolkken/kit#1347: the eslint cache key hashed `eslint/**/*.ts`, and in `eslint/` the only
// `.ts` files are the tests. So the key was the exact inverse of what makes a cache entry stale — a
// rule edit left it unchanged, a test edit busted it — and nothing asserted either half.
//
// It matters more now than it did. The fingerprint in `eslint/config-fingerprint.js` invalidates the
// entries themselves, so a rule edit under the old key would restore a cache whose every entry is
// stale, lint cold, and then save nothing back because the key it hit was already there: a cold lint
// on that run and on every run after it.
//
// **Asserted on the parsed input rather than on the file's text.** The key now carries a comment
// quoting the glob directly above it, so a whole-file `toContain` would pass on a workflow whose real
// key had regressed while the comment still read correctly — the guard would assert the comment.
// **The linting job goes by a different name in each file, and the cache follows the job that
// lints** (joshuafolkken/kit#1226). This repository's own workflow splits the gate across two
// runners, so the three static checks moved to `static-checks` and the name `Checks` was left to the
// job that aggregates both halves for the branch ruleset; the distributed template still runs one
// job, whose ordering constraints (build → eslint → browser-mode unit tests) do not admit the same
// split. Naming the job per file is what keeps this guard pointed at the step that actually holds
// the cache — looking it up under a name the file no longer uses would find no step, read the key as
// the empty string, and pass the `not.toContain` half while asserting nothing at all.
const RUNTIME_LINT_JOB = 'static-checks'
const TEMPLATE_LINT_JOB = 'checks'
const CACHE_STEP_ID = 'eslint-cache'
const KEY_INPUT = 'key'
const CONFIG_SOURCE_GLOB = "hashFiles('eslint.config.js', 'eslint/**/*.js')"
const TEST_SOURCE_GLOB = "'eslint/**/*.ts'"

function eslint_cache_key(relative_path: string, job_name: string): string {
	const job = ci_yml_fixture.find_job(relative_path, job_name)
	const step = ci_yml_fixture.find_step_by_id(job, CACHE_STEP_ID)

	return String(step?.with?.[KEY_INPUT] ?? '')
}

describe.each([
	[ci_yml_fixture.RUNTIME_CI_YML, RUNTIME_LINT_JOB],
	[ci_yml_fixture.TEMPLATE_CI_YML, TEMPLATE_LINT_JOB],
])('eslint cache key (%s)', (relative_path, job_name) => {
	// The lookup above returns the empty string for a job or step that is not there, which would let
	// both assertions below pass on a workflow that had lost the cache entirely.
	it('finds the cache step on the job that runs eslint', () => {
		expect(eslint_cache_key(relative_path, job_name)).not.toBe('')
	})

	it('keys the cache on the config sources the fingerprint reads', () => {
		expect(eslint_cache_key(relative_path, job_name)).toContain(CONFIG_SOURCE_GLOB)
	})

	it('does not key it on the tests beside them, which no cache entry depends on', () => {
		expect(eslint_cache_key(relative_path, job_name)).not.toContain(TEST_SOURCE_GLOB)
	})
})
