import { http_fault_injection } from '#scripts/test/http-fault-injection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sonar_hotspots_cli } from './sonar-hotspots-cli'

// joshuafolkken/kit#2355: `fetch_hotspots` is a real HTTP boundary, and this drives it through every
// network failure mode `josh cases` names — injected as a `fetch` stand-in, so the unit suite's
// network block (`test-network-guard.ts`) stays intact and no request leaves the machine. Each mode
// must degrade into an `error`, never a false empty success: a swallowed failure that answers
// `{ hotspots: [] }` would report "no hotspots" for a request that never completed.

const REQUEST_URL = 'https://sonarcloud.io/api/hotspots/search?projectKey=k&pullRequest=1'

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('sonar_hotspots_cli.fetch_hotspots — injected boundary failures', () => {
	it.each(http_fault_injection.NETWORK_MODES.map((mode) => [mode]))(
		'reports %s as an error rather than an empty success',
		async (mode) => {
			vi.stubGlobal('fetch', http_fault_injection.faulty_fetch(mode))

			const result = await sonar_hotspots_cli.fetch_hotspots(REQUEST_URL)

			expect('error' in result).toBe(true)
			expect('hotspots' in result).toBe(false)
		},
	)
})
