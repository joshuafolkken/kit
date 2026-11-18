import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const CONFIG_PATH = path.resolve(import.meta.dirname, '../../osv-scanner.toml')
const CONFIG = readFileSync(CONFIG_PATH, 'utf8')
const ENTRY_HEADER = '[[IgnoredVulns]]'
const ADVISORY_ID = 'GHSA-fc5q-39xc-vjpf'
const EXPIRY = '2026-12-02'

function read_entries(): Array<string> {
	return CONFIG.split(ENTRY_HEADER).slice(1)
}

function read_value(entry: string, key: string): string | undefined {
	const match = new RegExp(String.raw`^${key}\s*=\s*(.+)$`, 'mu').exec(entry)

	return match?.[1]?.trim()
}

describe('osv-scanner.toml', () => {
	it('ignores exactly one advisory', () => {
		expect(read_entries()).toHaveLength(1)
	})

	it('ignores only the picomatch advisory with no patched version', () => {
		const [entry = ''] = read_entries()

		expect(read_value(entry, 'id')).toBe(`"${ADVISORY_ID}"`)
	})

	it('expires the ignore on the decided date as a TOML date', () => {
		const [entry = ''] = read_entries()

		expect(read_value(entry, 'ignoreUntil')).toBe(EXPIRY)
	})

	it('states a non-empty reason', () => {
		const [entry = ''] = read_entries()

		expect(read_value(entry, 'reason')).toMatch(/^".+"$/u)
	})
})
