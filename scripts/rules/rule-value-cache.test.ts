import { mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rule_value_cache, type CachePorts } from './rule-value-cache'

const NOW_MS = Date.parse('2026-10-02T06:00:00.000Z')
const READING = 'issue-comments  reached 3  100% unaided  refused 0'
const MS_PER_SECOND = 1000

const context = { cwd: '', stderr: new Array<string>() }

function ports(start_refresh: CachePorts['start_refresh'] = vi.fn()): CachePorts {
	return { now: () => NOW_MS, start_refresh }
}

// Age the stamp so the last refresh started `age_ms` before `NOW_MS`.
function stamp_aged(age_ms: number): void {
	const stamp = rule_value_cache.cache_path(context.cwd, rule_value_cache.STAMP_FILE)
	const seconds = (NOW_MS - age_ms) / MS_PER_SECOND

	utimesSync(stamp, seconds, seconds)
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
		stamp_aged(rule_value_cache.REFRESH_MS)
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
