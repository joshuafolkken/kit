import { describe, expect, it } from 'vitest'
import { run_transcript } from './run-transcript-fixture'

// The golden transcript (joshuafolkken/kit#2250). The driver's computed step sequence for the
// representative scenarios is pinned byte-for-byte against a checked-in file: a regression in the steps
// shows as a golden diff instead of passing silently, which the prose slice it replaces could not do —
// a renumbered heading degraded its slice to an empty string and every `not.toContain` still passed.
//
// **Update the golden with `pnpm josh test:unit -u run-transcript` when the step change is intended.**
// One command, and the diff is the change.

describe('the run driver transcript', () => {
	it('matches the golden step sequence', async () => {
		await expect(run_transcript.render_all()).toMatchFileSnapshot('./run-transcript.golden.txt')
	})

	// The property the golden rests on: with no GitHub, clock, process or filesystem in the render, the
	// same fixture renders the same transcript every time.
	it('renders the same transcript for the same input', () => {
		expect(run_transcript.render_all()).toBe(run_transcript.render_all())
	})
})
