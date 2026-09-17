import { process_identity } from '#scripts/josh/process-identity'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { describe, expect, it } from 'vitest'
import { review_brief } from './review-brief'

const FILE = 'a.ts'
const DIGEST = 'x'
const BASE = 'fedcba9876543210fedcba9876543210fedcba98'
const STARTED_AT = '2026-09-03T02:00:00.000Z'
const RUNNING = 'Running now'
const NOT_VERIFIED = 'Not verified'

describe('review brief sandbox process identity fallback', () => {
	it.skipIf(process.platform === 'win32')(
		'recognizes a live gate without proc or ps and rejects its stale generation',
		() => {
			const tree = { [FILE]: DIGEST }
			const token =
				process_identity.resolve_own_start(process_identity_fixture.sandbox_probes(undefined)) ?? ''
			const marker = { taken_at: STARTED_AT, files: tree, pid: process.pid, process_start: token }

			try {
				expect(
					review_brief.gate_line({ gate: undefined, in_flight: marker }, tree, BASE),
				).toContain(RUNNING)
			} finally {
				process_identity.close_beacon(token)
			}

			expect(review_brief.gate_line({ gate: undefined, in_flight: marker }, tree, BASE)).toContain(
				NOT_VERIFIED,
			)
		},
	)
})
