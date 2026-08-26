import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { propagate } from './propagate'

const KIT = '@joshuafolkken/kit'
const MANIFEST = 'package.json'
const APP_KIT = '@joshuafolkken/app-kit'
const REFUSAL = 'Refusing to propagate'
const MISSPELLED_FLAG = '--dryrun'
const VERSION = '1.111.0'

const state = { workspace: '' }

function make_repository(name: string, version?: string): string {
	const repository_path = mkdtempSync(path.join(state.workspace, 'repo-'))

	writeFileSync(path.join(repository_path, MANIFEST), JSON.stringify({ name, version }))

	return repository_path
}

beforeEach(() => {
	state.workspace = mkdtempSync(path.join(tmpdir(), 'propagate-guard-'))
})

afterEach(() => {
	rmSync(state.workspace, { recursive: true, force: true })
})

// The guard is also the concurrency answer: in the per-repository session model exactly one session
// stands in the supplier repository, so exactly one session can propagate (joshuafolkken/kit#861).
describe('propagate.refuse_outside_source_repository', () => {
	it('allows the run inside the supplier own repository', () => {
		expect(propagate.refuse_outside_source_repository(make_repository(KIT))).toBeUndefined()
	})

	it('refuses the run from a consumer repository', () => {
		const refusal = propagate.refuse_outside_source_repository(make_repository(APP_KIT))

		expect(refusal).toContain(REFUSAL)
	})

	it('refuses the run from a directory with no manifest at all', () => {
		expect(propagate.refuse_outside_source_repository(state.workspace)).toContain(REFUSAL)
	})
})

describe('propagate.resolve_run_version', () => {
	it('reads the supplier own declared version, not whatever is newest', () => {
		expect(propagate.resolve_target_version(make_repository(KIT, VERSION))).toBe(VERSION)
	})

	it('refuses rather than guessing when the version cannot be read', () => {
		const { version, refusal } = propagate.resolve_run_version(make_repository(KIT))

		expect(version).toBeUndefined()
		expect(refusal).toContain('nothing to propagate')
	})

	// The supplier directories these tests build are not git repositories, so the tree check refuses
	// them — which is the same guarantee that keeps a supplier checkout that is behind from
	// propagating the previous release.
	it('refuses a supplier checkout it cannot confirm is clean and current', () => {
		const { version, refusal } = propagate.resolve_run_version(make_repository(KIT, VERSION))

		expect(version).toBeUndefined()
		expect(refusal).toContain(REFUSAL)
	})

	// A dry run writes nothing, so the same unready supplier is a warning there and the target list
	// still gets printed.
	it('warns instead of refusing on a dry run, and still reports a version', () => {
		const resolved = propagate.resolve_run_version(make_repository(KIT, VERSION), true)

		expect(resolved.version).toBe(VERSION)
		expect(resolved.warning).toContain('a real run would refuse')
	})

	it('refuses outside the supplier repository before reading any version', () => {
		const consumer = make_repository(APP_KIT, '9.9.9')

		expect(propagate.resolve_run_version(consumer).version).toBeUndefined()
	})
})

describe('propagate.parse_options', () => {
	it('accepts the documented flags', () => {
		const options = propagate.parse_options(['--dry-run', '--skip-publish-wait'])

		expect(options.usage).toBeUndefined()
		expect(options.is_dry_run).toBe(true)
		expect(options.is_publish_wait_skipped).toBe(true)
	})

	it('accepts no flags at all', () => {
		expect(propagate.parse_options([]).is_dry_run).toBe(false)
	})

	// A misspelled `--dryrun` that is silently ignored runs the real write path against every
	// consumer, which is the opposite of what was asked for.
	it('refuses a misspelled flag instead of running the real thing', () => {
		const options = propagate.parse_options([MISSPELLED_FLAG])

		expect(options.usage).toContain(MISSPELLED_FLAG)
		expect(options.usage).toContain('Usage:')
	})

	it('names every accepted flag in the usage line', () => {
		const { usage } = propagate.parse_options(['--nope'])

		for (const flag of propagate.KNOWN_FLAGS) expect(usage).toContain(flag)
	})
})

describe('josh propagate registration', () => {
	it('is registered as a Project command', () => {
		const { propagate: entry } = COMMAND_MAP

		expect(entry?.script).toBe('scripts/propagate/propagate.ts')
	})

	it('is reachable through the pg alias', () => {
		const { pg } = ALIASES

		expect(pg).toBe('propagate')
	})
})
