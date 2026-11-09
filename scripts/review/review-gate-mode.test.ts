import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_gate_mode } from './review-gate-mode'

const ENV_KEY = 'JOSH_REVIEW_GATE'
const CI_MANIFEST = '{"josh":{"review_gate":"ci"}}'
const LOCAL_MANIFEST = '{"josh":{"review_gate":"local"}}'
const INVALID_MANIFESTS = [
	'{',
	'{}',
	'{"josh":{}}',
	'{"josh":null}',
	'{"josh":{"review_gate":"other"}}',
	'{"josh":{"review_gate":null}}',
	'{"josh":{"review_gate":1}}',
]
const fixture = { root: '', nested: '' }
const make_directory = temporary_directory()

function write_manifest(directory: string, contents: string): void {
	writeFileSync(path.join(directory, PACKAGE_JSON), contents)
}

beforeEach(() => {
	fixture.root = make_directory('review-gate-mode-')
	fixture.nested = path.join(fixture.root, 'nested')
	mkdirSync(fixture.nested)
	vi.stubEnv(ENV_KEY, '')
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('review_gate_mode.read', () => {
	it('defaults to local when no source declares a mode', () => {
		vi.stubEnv(ENV_KEY, undefined)
		expect(review_gate_mode.read(fixture.root)).toBe('local')
	})

	it.each(['ci', 'local'])('reads %s from the environment before the manifest', (mode) => {
		vi.stubEnv(ENV_KEY, mode)
		write_manifest(fixture.root, mode === 'ci' ? LOCAL_MANIFEST : CI_MANIFEST)

		expect(review_gate_mode.read(fixture.root)).toBe(mode)
	})

	it.each(['', 'CI', ' ci ', 'other'])('ignores unusable environment value %j', (mode) => {
		vi.stubEnv(ENV_KEY, mode)
		write_manifest(fixture.root, CI_MANIFEST)

		expect(review_gate_mode.read(fixture.root)).toBe('ci')
	})

	it('uses the working directory when no directory is supplied', () => {
		vi.spyOn(process, 'cwd').mockReturnValue(fixture.root)
		write_manifest(fixture.root, CI_MANIFEST)

		expect(review_gate_mode.read()).toBe('ci')
	})
})

describe('review_gate_mode.read — manifest discovery and validation', () => {
	it('finds the nearest declaring manifest above the start', () => {
		write_manifest(fixture.root, CI_MANIFEST)

		expect(review_gate_mode.read(fixture.nested)).toBe('ci')
		write_manifest(fixture.nested, LOCAL_MANIFEST)
		expect(review_gate_mode.read(fixture.nested)).toBe('local')
	})

	it.each(INVALID_MANIFESTS)('falls through invalid or absent declarations: %s', (contents) => {
		write_manifest(fixture.nested, contents)
		expect(review_gate_mode.read(fixture.nested)).toBe('local')
		write_manifest(fixture.root, CI_MANIFEST)
		expect(review_gate_mode.read(fixture.nested)).toBe('ci')
	})

	it('reads a valid review mode independently of an invalid progress interval', () => {
		write_manifest(fixture.root, '{"josh":{"review_gate":"ci","progress_interval_minutes":0}}')

		expect(review_gate_mode.read(fixture.root)).toBe('ci')
	})
})
