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
const RESTORE_KEYS_INPUT = 'restore-keys'
const CONFIG_SOURCE_GLOB = "hashFiles('eslint.config.js', 'eslint/**/*.js')"
const TEST_SOURCE_GLOB = "'eslint/**/*.ts'"
// joshuafolkken/kit#4346: ESLint hashes `process.version` into every entry, and runner images carry
// different Node.js patch releases, so a key without the resolved version restored a cold cache.
const SETUP_NODE_STEP_ID = 'setup-node'
const NODE_VERSION_OUTPUT = 'node-version'
const NODE_VERSION_EXPRESSION = `\${{ steps.${SETUP_NODE_STEP_ID}.outputs.${NODE_VERSION_OUTPUT} }}`
const SETUP_NODE_ACTION = '.github/actions/setup-node/action.yml'

function eslint_cache_input(relative_path: string, job_name: string, input: string): string {
	const job = ci_yml_fixture.find_job(relative_path, job_name)
	const step = ci_yml_fixture.find_step_by_id(job, CACHE_STEP_ID)

	return String(step?.with?.[input] ?? '')
}

function eslint_cache_key(relative_path: string, job_name: string): string {
	return eslint_cache_input(relative_path, job_name, KEY_INPUT)
}

function eslint_cache_keys(relative_path: string, job_name: string): Array<string> {
	const restore_keys = eslint_cache_input(relative_path, job_name, RESTORE_KEYS_INPUT)
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')

	return [eslint_cache_key(relative_path, job_name), ...restore_keys]
}

function setup_node_uses(relative_path: string, job_name: string): string | undefined {
	const job = ci_yml_fixture.find_job(relative_path, job_name)

	return ci_yml_fixture.find_step_by_id(job, SETUP_NODE_STEP_ID)?.uses
}

describe('setup-node composite action', () => {
	it('exposes the Node.js version actions/setup-node resolved', () => {
		const action = ci_yml_fixture.load_action(SETUP_NODE_ACTION)
		const step = action.runs.steps.find((candidate) => candidate.id === SETUP_NODE_STEP_ID)

		expect(step?.uses).toContain('actions/setup-node@')
		expect(action.outputs?.[NODE_VERSION_OUTPUT]?.value).toBe(NODE_VERSION_EXPRESSION)
	})
})

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

	it('names the Node.js version the job set up in the key and every restore-key', () => {
		const keys = eslint_cache_keys(relative_path, job_name)

		expect(setup_node_uses(relative_path, job_name)).toBe('./.github/actions/setup-node')
		expect(keys.length).toBeGreaterThan(1)
		for (const key of keys) expect(key).toContain(`-eslint-cache-${NODE_VERSION_EXPRESSION}-`)
	})
})
