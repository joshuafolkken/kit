import { describe, expect, it } from 'vitest'
import { process_identity } from './process-identity'

// More synchronous self-probes than the Unix socket's pending connection backlog. The owner
// cannot accept connections while spawnSync blocks its event loop (joshuafolkken/kit#5426).
const PROBE_COUNT = 256

describe('process_identity — repeated sandbox self-verification', () => {
	it.skipIf(process.platform === 'win32')(
		'keeps its live generation through synchronous polls',
		() => {
			const token = process_identity.open_beacon() ?? ''

			try {
				expect(token).toMatch(/^socket:/u)

				const readings = Array.from({ length: PROBE_COUNT }, () =>
					process_identity.is_same_process(process.pid, token),
				)

				expect(readings).toEqual(Array.from({ length: PROBE_COUNT }, () => true))
			} finally {
				process_identity.close_beacon(token)
			}

			expect(process_identity.is_same_process(process.pid, token)).toBe(false)
		},
	)
})
