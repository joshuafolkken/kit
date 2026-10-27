import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rule_value_cache, type CachePorts } from './rule-value-cache'

const NOW_MS = Date.parse('2026-10-02T06:00:00.000Z')
const READING = 'issue-comments  reached 3  100% unaided  refused 0'

const context = { cwd: '', stderr: new Array<string>() }

function ports(start_refresh: CachePorts['start_refresh'] = vi.fn()): CachePorts {
	return { now: () => NOW_MS, start_refresh }
}

// Age a cache file so it was last written `age_ms` before `NOW_MS` — the stamp for when the last
// refresh started, the reading for when it was taken.
function file_aged(file: string, age_ms: number): void {
	const seconds = (NOW_MS - age_ms) / MS_PER_SECOND

	utimesSync(rule_value_cache.cache_path(context.cwd, file), seconds, seconds)
}

beforeEach(() => {
	context.cwd = mkdtempSync(path.join(tmpdir(), 'rule-value-cache-'))
	context.stderr = []
	vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
		context.stderr.push(String(chunk))

		return true
	})
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(context.cwd, { recursive: true, force: true })
})

describe('rule_value_cache.emit — the loop head never measures', () => {
	it('prints the stored reading to stderr', () => {
		rule_value_cache.store(READING, context.cwd)
		rule_value_cache.emit(context.cwd, ports())

		expect(context.stderr).toStrictEqual([`${READING}\n`])
	})

	it('prints nothing and starts a refresh when no reading is stored yet', () => {
		const start_refresh = vi.fn()

		rule_value_cache.emit(context.cwd, ports(start_refresh))

		expect(context.stderr).toStrictEqual([])
		expect(start_refresh).toHaveBeenCalledExactlyOnceWith(context.cwd)
	})

	it('starts no second refresh inside the interval', () => {
		const start_refresh = vi.fn()

		rule_value_cache.emit(context.cwd, ports(start_refresh))
		rule_value_cache.emit(context.cwd, ports(start_refresh))

		expect(start_refresh).toHaveBeenCalledOnce()
	})

	it('starts a refresh again once the interval has passed', () => {
		const start_refresh = vi.fn()

		rule_value_cache.emit(context.cwd, ports(start_refresh))
		file_aged(rule_value_cache.STAMP_FILE, rule_value_cache.REFRESH_MS)
		rule_value_cache.emit(context.cwd, ports(start_refresh))

		expect(start_refresh).toHaveBeenCalledTimes(2)
	})

	it('never throws when the refresh cannot start', () => {
		const start_refresh = vi.fn(() => {
			throw new Error('spawn failed')
		})

		expect(() => {
			rule_value_cache.emit(context.cwd, ports(start_refresh))
		}).not.toThrow()
	})
})

describe('rule_value_cache.store — the detached refresh writes the reading whole', () => {
	it('writes the reading where the loop head reads it', () => {
		rule_value_cache.store(READING, context.cwd)

		const stored = readFileSync(
			rule_value_cache.cache_path(context.cwd, rule_value_cache.CACHE_FILE),
			'utf8',
		)

		expect(stored).toBe(`${READING}\n`)
	})
})

describe('rule_value_cache.read_fresh — the reading only inside the refresh interval', () => {
	it('returns the reading and when it was taken while it is fresh', () => {
		rule_value_cache.store(READING, context.cwd)
		file_aged(rule_value_cache.CACHE_FILE, rule_value_cache.REFRESH_MS - MS_PER_SECOND)

		expect(rule_value_cache.read_fresh(context.cwd, NOW_MS)).toStrictEqual({
			text: `${READING}\n`,
			taken_at: new Date(NOW_MS - rule_value_cache.REFRESH_MS + MS_PER_SECOND),
		})
	})

	it('misses once the reading is as old as the refresh interval', () => {
		rule_value_cache.store(READING, context.cwd)
		file_aged(rule_value_cache.CACHE_FILE, rule_value_cache.REFRESH_MS)

		expect(rule_value_cache.read_fresh(context.cwd, NOW_MS)).toBeUndefined()
	})

	it('misses when no reading is stored', () => {
		expect(rule_value_cache.read_fresh(context.cwd, NOW_MS)).toBeUndefined()
	})
})

describe('rule_value_cache — a lane never writes the main checkout reading', () => {
	beforeEach(() => {
		vi.spyOn(git_common_directory, 'resolve').mockReturnValue(path.join(context.cwd, '.git'))
	})

	it('stores nothing from a linked work tree', () => {
		rule_value_cache.store(READING, context.cwd)

		expect(existsSync(rule_value_cache.cache_path(context.cwd, rule_value_cache.CACHE_FILE))).toBe(
			false,
		)
	})

	it('starts no refresh and writes no stamp from a linked work tree', () => {
		const start_refresh = vi.fn()

		rule_value_cache.emit(context.cwd, ports(start_refresh))

		expect(start_refresh).not.toHaveBeenCalled()
		expect(existsSync(rule_value_cache.cache_path(context.cwd, rule_value_cache.STAMP_FILE))).toBe(
			false,
		)
	})
})

describe('rule_value_cache.cache_path — one cache for every work tree of a repository', () => {
	it('resolves into the common git directory inside a repository', () => {
		const common = path.join(context.cwd, 'main', '.git')

		vi.spyOn(git_common_directory, 'repository').mockReturnValue(common)

		expect(rule_value_cache.cache_path(context.cwd, rule_value_cache.CACHE_FILE)).toBe(
			path.join(common, git_common_directory.STATE_DIRECTORY, rule_value_cache.CACHE_FILE),
		)
	})

	it('falls back to the directory itself outside a repository', () => {
		expect(rule_value_cache.cache_path(context.cwd, rule_value_cache.CACHE_FILE)).toBe(
			path.join(context.cwd, 'node_modules', '.cache', 'josh', rule_value_cache.CACHE_FILE),
		)
	})
})
