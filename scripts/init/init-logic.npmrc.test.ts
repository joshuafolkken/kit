import { describe, expect, it } from 'vitest'
import { init_logic } from './init-logic'

// The four settings lines earlier kit releases wrote. pnpm 12 ignores every one of them in `.npmrc`,
// so a merge strips exactly these and leaves every other line alone (joshuafolkken/kit#3267).
const LEGACY_LINES: ReadonlyArray<string> = [
	'engine-strict=true',
	'minimum-release-age=1440',
	'confirmModulesPurge=false',
	'lockfile-include-tarball-url=true',
]
const REGISTRY_LINE = '@joshuafolkken:registry=https://npm.pkg.github.com'
const OTHER_LINE = 'other=value'
const PLACEHOLDER_AUTH_LINE = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'
const LITERAL_AUTH_LINE = '//npm.pkg.github.com/:_authToken=ghp_literal123'

describe('merge_npmrc — legacy settings lines', () => {
	it.each(LEGACY_LINES)('removes the legacy line %s', (line) => {
		expect(init_logic.merge_npmrc(`${REGISTRY_LINE}\n${line}\n`)).toBe(`${REGISTRY_LINE}\n`)
	})

	it('removes every legacy line at once and keeps the rest in order', () => {
		const content = `${LEGACY_LINES.join('\n')}\n${REGISTRY_LINE}\n${OTHER_LINE}\n`

		expect(init_logic.merge_npmrc(content)).toBe(`${REGISTRY_LINE}\n${OTHER_LINE}\n`)
	})

	it('removes a legacy line carrying a CRLF ending', () => {
		const content = `${REGISTRY_LINE}\r\nengine-strict=true\r\n`

		expect(init_logic.merge_npmrc(content)).toBe(`${REGISTRY_LINE}\r\n`)
	})

	it('removes a legacy last line that lacks a trailing newline', () => {
		expect(init_logic.merge_npmrc(`${REGISTRY_LINE}\nengine-strict=true`)).toBe(REGISTRY_LINE)
	})

	// Only the exact kit-written value is legacy: a consumer's own window is their decision to move.
	it('keeps a custom value of a legacy key', () => {
		const content = `${REGISTRY_LINE}\nminimum-release-age=4320\n`

		expect(init_logic.merge_npmrc(content)).toBe(content)
	})
})

describe('merge_npmrc — content without legacy lines', () => {
	it('returns empty content unchanged', () => {
		expect(init_logic.merge_npmrc('')).toBe('')
	})

	it('returns content unchanged when nothing legacy is present', () => {
		const content = `${REGISTRY_LINE}\n${OTHER_LINE}\n`

		expect(init_logic.merge_npmrc(content)).toBe(content)
	})

	it('is idempotent — a second merge changes nothing', () => {
		const once = init_logic.merge_npmrc(`${LEGACY_LINES.join('\n')}\n${OTHER_LINE}\n`)

		expect(init_logic.merge_npmrc(once)).toBe(once)
	})
})

// Regression guard for #759: the env-var placeholder form is the live credential wherever
// `npmrcAuthFile` declares the project .npmrc trusted, and that opt-in can live in a deploy
// platform's dashboard, invisible here. Merging must never delete it.
describe('merge_npmrc — existing auth lines survive', () => {
	it('keeps the env-var auth line npmrcAuthFile makes live', () => {
		const result = init_logic.merge_npmrc(`engine-strict=true\n${PLACEHOLDER_AUTH_LINE}\n`)

		expect(result).toBe(`${PLACEHOLDER_AUTH_LINE}\n`)
	})

	it('keeps a literal token line, which pnpm honors unconditionally', () => {
		const existing = `${REGISTRY_LINE}\n${LITERAL_AUTH_LINE}\n`

		expect(init_logic.merge_npmrc(existing)).toBe(existing)
	})

	it('keeps the auth line when the content lacks a trailing newline', () => {
		const result = init_logic.merge_npmrc(`minimum-release-age=1440\n${PLACEHOLDER_AUTH_LINE}`)

		expect(result).toBe(PLACEHOLDER_AUTH_LINE)
	})
})
