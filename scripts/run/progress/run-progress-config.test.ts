import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { run_progress } from './run-progress'
import { run_progress_config } from './run-progress-config'

// joshuafolkken/kit#1576. The interval had exactly one home and it was `.env`, which is deliberately
// never committed — so a cadence set on one machine was the default on every other machine and in
// every cloud session, and the guard that enforces the floor read the default with it. What is pinned
// here is the order the two sources are asked in, that an unusable answer falls through to the next
// rather than ending an unattended run, and that the guard and the watcher cannot read different
// answers from different directories of one repository.

const MINUTE = run_progress.MS_PER_MINUTE
const DEFAULT_MINUTES = 20
const COMMITTED = 15
const PERSONAL = 25
const TYPED = 5
const NESTED = 'workspace-'
const NO_INTERVAL = '{"josh":{}}'
// Ten hours after the epoch, so every expected stamp below reads `10:mm` in UTC whatever zone the
// suite runs in.
const OBSERVED_AT = 10 * 60 * MINUTE

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'josh-run-progress-config-'))

function bare_directory(prefix: string): string {
	return mkdtempSync(path.join(WORK_DIRECTORY, prefix))
}

function directory_with(contents: string): string {
	const directory = bare_directory('package-')

	writeFileSync(path.join(directory, run_progress_config.PACKAGE_FILE), contents)

	return directory
}

function directory_declaring(minutes: number): string {
	return directory_with(JSON.stringify({ josh: { progress_interval_minutes: minutes } }))
}

const EMPTY = directory_with('{}')

afterEach(() => {
	vi.unstubAllEnvs()
})

afterAll(() => {
	rmSync(WORK_DIRECTORY, { force: true, recursive: true })
})

describe('resolve_interval_ms — flag, environment, repository, default', () => {
	it('falls all the way through to twenty minutes', () => {
		vi.stubEnv(run_progress.INTERVAL_KEY, '')

		expect(run_progress_config.resolve_interval_ms(undefined, EMPTY)).toBe(DEFAULT_MINUTES * MINUTE)
	})

	it('takes the interval the repository commits when the environment says nothing', () => {
		vi.stubEnv(run_progress.INTERVAL_KEY, '')
		const declaring = directory_declaring(COMMITTED)

		expect(run_progress_config.resolve_interval_ms(undefined, declaring)).toBe(COMMITTED * MINUTE)
	})

	it("lets the person's own machine outrank the repository", () => {
		vi.stubEnv(run_progress.INTERVAL_KEY, String(PERSONAL))
		const declaring = directory_declaring(COMMITTED)

		expect(run_progress_config.resolve_interval_ms(undefined, declaring)).toBe(PERSONAL * MINUTE)
	})

	it('lets a typed flag outrank both', () => {
		vi.stubEnv(run_progress.INTERVAL_KEY, String(PERSONAL))
		const declaring = directory_declaring(COMMITTED)

		expect(run_progress_config.resolve_interval_ms(String(TYPED), declaring)).toBe(TYPED * MINUTE)
	})

	// The guard's floor is the same order with no command line in it, because a hook has no flag to
	// read — and a guard that could disagree with the watcher it guards is worse than no guard.
	it('answers the guard from the same order, minus the flag', () => {
		vi.stubEnv(run_progress.INTERVAL_KEY, '')
		const declaring = directory_declaring(COMMITTED)

		expect(run_progress_config.configured_interval_ms(declaring)).toBe(COMMITTED * MINUTE)
	})
})

// joshuafolkken/kit#1726. The next report time is printed rather than derived by the run, and what
// makes that a single implementation rather than a second one is that it is built from the interval
// this module resolves — so each of the three sources has to move the printed stamp.
describe('the printed next report time follows the interval this module resolved', () => {
	it.each([
		['a typed flag', String(TYPED), String(PERSONAL), '1970-01-01T10:05Z'],
		['the environment', undefined, String(PERSONAL), '1970-01-01T10:25Z'],
		['the repository', undefined, '', '1970-01-01T10:15Z'],
	])('takes %s', (_label, typed, environment, expected) => {
		vi.stubEnv(run_progress.INTERVAL_KEY, environment)
		const interval_ms = run_progress_config.resolve_interval_ms(
			typed,
			directory_declaring(COMMITTED),
		)

		expect(run_progress.format_next_report(OBSERVED_AT, interval_ms)).toContain(expected)
	})

	it('writes it on the local clock as well, with the offset that places it', () => {
		const stamp = run_progress.format_next_report(OBSERVED_AT, run_progress.DEFAULT_INTERVAL_MS)

		expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}[+-]\d{2}:\d{2} \/ /u)
	})
})

// The two callers do not stand in the same directory, so a reader that looked only at the one it was
// handed would let the hook enforce the repository's cadence while the watcher kept the default.
describe('read_package_minutes — the nearest declaring package.json, searched upward', () => {
	it('finds the declaration a directory above the one it was given', () => {
		const root = directory_declaring(COMMITTED)
		const nested = mkdtempSync(path.join(root, NESTED))

		expect(run_progress_config.read_package_minutes(nested)).toBe(COMMITTED)
	})

	it('stops at the first package.json that declares one', () => {
		const root = directory_declaring(COMMITTED)
		const nested = mkdtempSync(path.join(root, NESTED))

		writeFileSync(path.join(nested, run_progress_config.PACKAGE_FILE), NO_INTERVAL)

		expect(run_progress_config.read_package_minutes(nested)).toBe(COMMITTED)
	})
})

describe('read_package_minutes — an unusable answer falls through rather than throwing', () => {
	it.each([['0'], ['-5'], ['"fifteen"'], ['null']])('ignores %s as an interval', (literal) => {
		const directory = directory_with(`{"josh":{"progress_interval_minutes":${literal}}}`)

		expect(run_progress_config.read_package_minutes(directory)).toBeUndefined()
	})

	it.each([
		['no josh field', '{}'],
		['no interval field', NO_INTERVAL],
		['malformed JSON', '{'],
	])('ignores a package.json with %s', (_label, contents) => {
		expect(run_progress_config.read_package_minutes(directory_with(contents))).toBeUndefined()
	})

	it('answers undefined where there is no package.json at all', () => {
		const bare = bare_directory('bare-')

		expect(run_progress_config.read_package_minutes(bare)).toBeUndefined()
	})
})

// The acceptance condition itself: the mechanism existing is not the same as the cadence reaching
// another machine. Without a committed field in this repository's own `package.json`, a session
// started anywhere else reports at the default however the person set `.env` here.
describe('this repository commits an interval of its own', () => {
	it('declares a positive number of minutes', () => {
		const minutes = run_progress_config.read_package_minutes(PROJECT_ROOT)

		expect(minutes).toBeGreaterThan(0)
	})
})
