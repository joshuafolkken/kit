import { describe, expect, it } from 'vitest'
import { PORT_SEED_KEY, ports, type PortEnvironment } from './index.js'

const DEFAULT_DEV_PORT = 5173
const DEFAULT_PREVIEW_PORT = 4173
const SEED = 1
// Stated independently of the module's own arithmetic: the highest seed that still keeps the dev
// port — the higher of the two bases — inside the 65535 the protocol allows.
const MAX_SEED = 60_362
const ABOVE_MAX_SEED = String(MAX_SEED + 1)

// A silent fallback to 0 would put two projects back on one port, which is the failure the seed
// exists to remove, so every rejected shape has to raise instead of defaulting.
const REJECTED_SEEDS: ReadonlyArray<string> = ['abc', '-1', '1.5', '', ' ', '1e3', '+1']

function environment(seed: string | undefined): PortEnvironment {
	return { [PORT_SEED_KEY]: seed }
}

describe('ports.resolve_seed', () => {
	// The variable name is the whole public interface a developer types into `.env`, so renaming it
	// silently would leave every documented example pointing at a variable nothing reads.
	it('reads PORT_SEED', () => {
		expect(PORT_SEED_KEY).toBe('PORT_SEED')
	})

	it('is 0 when PORT_SEED is unset, so CI and un-migrated consumers are unaffected', () => {
		expect(ports.resolve_seed({})).toBe(0)
	})

	it('reads an integer seed', () => {
		expect(ports.resolve_seed(environment('7'))).toBe(7)
	})

	it('accepts the highest seed that keeps both ports below the protocol maximum', () => {
		const highest = environment(String(MAX_SEED))

		expect(ports.resolve_seed(highest)).toBe(MAX_SEED)
	})

	it.each([...REJECTED_SEEDS, ABOVE_MAX_SEED])(
		'rejects %j instead of falling back to the default',
		(seed) => {
			expect(() => ports.resolve_seed(environment(seed))).toThrow(PORT_SEED_KEY)
		},
	)

	it('names the default ports in the error so the fix is visible without reading the docs', () => {
		expect(() => ports.resolve_seed(environment('abc'))).toThrow(String(DEFAULT_DEV_PORT))
	})
})

describe('ports.resolve_development_port / ports.resolve_preview_port', () => {
	it('keeps todays ports when PORT_SEED is unset', () => {
		expect(ports.resolve_development_port({})).toBe(DEFAULT_DEV_PORT)
		expect(ports.resolve_preview_port({})).toBe(DEFAULT_PREVIEW_PORT)
	})

	it('moves both ports by the same seed', () => {
		const seeded = environment(String(SEED))

		expect(ports.resolve_development_port(seeded)).toBe(DEFAULT_DEV_PORT + SEED)
		expect(ports.resolve_preview_port(seeded)).toBe(DEFAULT_PREVIEW_PORT + SEED)
	})

	it('gives two seeds two distinct port pairs, so both previews can run at once', () => {
		const first = ports.resolve_preview_port(environment('1'))
		const second = ports.resolve_preview_port(environment('2'))

		expect(first).not.toBe(second)
	})

	it('propagates an invalid seed rather than serving a default port', () => {
		expect(() => ports.resolve_development_port(environment('abc'))).toThrow(PORT_SEED_KEY)
		expect(() => ports.resolve_preview_port(environment('abc'))).toThrow(PORT_SEED_KEY)
	})
})
