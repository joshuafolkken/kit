import { gate_skip } from '#scripts/gate-skip'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import {
	ESLINT_CACHE_FILE,
	ESLINT_EDIT_CACHE_FLAGS,
	GATE_CACHE_FILES,
	IGNORED_CACHE_FILES,
} from '#scripts/josh/josh-command-types'
import { describe, expect, it } from 'vitest'
import { bench_targets } from './bench-targets'

const LINT = 'lint'
const GATE = 'gate'
const UNIT = 'test:unit'
const EDIT_CACHE = ESLINT_EDIT_CACHE_FLAGS.at(-1)
// A `josh` sub-command that exists but is not measurable, so the refusal is exercised on a plausible
// mistake rather than on a string nobody would type.
const UNKNOWN_TARGET = 'lint:staged'

describe('bench targets — what each target measures', () => {
	it('names a target for every check the gate runs, and the gate itself', () => {
		expect(bench_targets.BENCH_TARGETS.map((target) => target.name)).toStrictEqual([
			LINT,
			'check',
			'cspell:dot',
			UNIT,
			GATE,
		])
	})

	it('resolves every target to a command josh can run', () => {
		for (const target of bench_targets.BENCH_TARGETS) {
			expect(COMMAND_MAP[target.name], `${target.name} is not a josh command`).toBeDefined()
		}
	})

	// The per-target half of the acceptance criterion: clearing all three caches before the lint step
	// would report a cold type check and a cold spell check as part of the lint's own cost.
	it('clears only the cache the measured command itself writes', () => {
		expect(bench_targets.find_target(LINT)?.caches).toStrictEqual([ESLINT_CACHE_FILE])
	})

	it('clears every gate cache when the whole gate is the target', () => {
		expect(bench_targets.find_target(GATE)?.caches).toStrictEqual(GATE_CACHE_FILES)
	})

	// A cold figure means one thing where a cache was emptied and another where none exists, so the
	// unit suite declares none rather than pretending its two readings differ for a cache reason.
	it('declares no cache for the check that keeps none in the working tree', () => {
		expect(bench_targets.find_target(UNIT)?.caches).toStrictEqual([])
	})

	it('leaves the whole gate out of the default set, since it repeats the other four', () => {
		expect(bench_targets.DEFAULT_TARGETS.map((target) => target.name)).not.toContain(GATE)
	})
})

describe('bench targets — the flags a measurement needs', () => {
	// Without `--force` the gate reuses the green result the cold run just recorded on this very tree
	// (joshuafolkken/kit#1328), so the warm reading would be the skip notice rather than a run — a
	// fraction of a second, printed as a several-hundred-fold cache win.
	it('measures the gate with the flag that stops it reusing a green result', () => {
		expect(bench_targets.find_target(GATE)?.flags).toStrictEqual([gate_skip.FORCE_FLAG])
	})

	it('measures every other target with no flags of its own', () => {
		for (const target of bench_targets.DEFAULT_TARGETS) {
			expect(target.flags, `${target.name} has unexpected flags`).toStrictEqual([])
		}
	})
})

// "副作用が作業ツリーに残らない" — the acceptance criterion. Every removable path is one the gate
// declares as its own cache file, and `gate-cache-flags.test.ts` already asserts that each of those
// is git-ignored and spell-check-excluded, so membership here is the whole guarantee.
describe('bench targets — nothing outside the gate caches is ever removed', () => {
	it('declares only cache files the ignore rules already cover', () => {
		for (const target of bench_targets.BENCH_TARGETS) {
			for (const cache of target.caches) {
				expect(IGNORED_CACHE_FILES, `${cache} is not an ignored cache file`).toContain(cache)
			}
		}
	})

	it('accepts every declared cache as clearable', () => {
		for (const target of bench_targets.BENCH_TARGETS) {
			expect(bench_targets.clearable_caches(target)).toStrictEqual(target.caches)
		}
	})

	// joshuafolkken/kit#1332: the edit hook's cache is the one file a second writer must never touch.
	it('refuses the edit hook cache the gate must never share', () => {
		expect(bench_targets.is_clearable(String(EDIT_CACHE))).toBe(false)
	})

	it('refuses a path that would walk out of the checkout', () => {
		expect(bench_targets.is_clearable('../../.eslintcache')).toBe(false)
		expect(bench_targets.is_clearable('nested/.eslintcache')).toBe(false)
	})

	it('refuses a file that is not a cache at all', () => {
		expect(bench_targets.is_clearable('package.json')).toBe(false)
	})
})

describe('bench targets — resolving what the command line asked for', () => {
	it('measures the default set when no target is named', () => {
		expect(bench_targets.resolve_targets([]).targets).toStrictEqual(bench_targets.DEFAULT_TARGETS)
	})

	it('measures exactly the named targets, in the order they were given', () => {
		const { targets, unknown } = bench_targets.resolve_targets([GATE, LINT])

		expect(targets.map((target) => target.name)).toStrictEqual([GATE, LINT])
		expect(unknown).toStrictEqual([])
	})

	// Reported rather than dropped: a mistyped name that silently measured the default set would
	// answer a question nobody asked.
	it('reports a name it does not recognize instead of ignoring it', () => {
		const { targets, unknown } = bench_targets.resolve_targets([LINT, UNKNOWN_TARGET])

		expect(targets.map((target) => target.name)).toStrictEqual([LINT])
		expect(unknown).toStrictEqual([UNKNOWN_TARGET])
	})
})
