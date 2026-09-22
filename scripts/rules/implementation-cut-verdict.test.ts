import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { afterEach, describe, expect, it } from 'vitest'
import { implementation_cut_verdict } from './implementation-cut-verdict'

// joshuafolkken/kit#2385: `is_over_threshold_edit` now fires per threshold crossing, so its
// transcript-priced verdict read is a candidate on every edit — and `pnpm josh rule:guard` runs as a
// fresh process each `PreToolUse`, so the reuse has to survive across processes in a per-checkout
// stamp. This suite pins that a burst of edits inside the window shares one read and that the first
// edit past it re-reads.

const DIRECTORY = mkdtempSync(path.join(tmpdir(), 'impl-cut-verdict-'))
const OVER: CostVerdict = 'over'
const UNDER: CostVerdict = 'under'
const NOW_MS = 5_000_000
const WINDOW = implementation_cut_verdict.VERDICT_REUSE_MS

// A reader that counts its calls, so "read once" and "read again" are assertions rather than guesses.
function counting_reader(value: CostVerdict): { read: () => CostVerdict; calls: () => number } {
	let calls = 0

	return {
		read: (): CostVerdict => {
			calls += 1

			return value
		},
		calls: (): number => calls,
	}
}

afterEach(() => {
	rmSync(implementation_cut_verdict.cache_path(DIRECTORY), { force: true })
})

describe('reused_verdict', () => {
	it('reads once and reuses the stored verdict across a burst inside the window', () => {
		const reader = counting_reader(OVER)

		const { read } = reader
		const first = implementation_cut_verdict.reused_verdict(read, DIRECTORY, NOW_MS)
		const second = implementation_cut_verdict.reused_verdict(read, DIRECTORY, NOW_MS + 1)
		const third = implementation_cut_verdict.reused_verdict(read, DIRECTORY, NOW_MS + WINDOW - 1)

		expect([first, second, third]).toStrictEqual([OVER, OVER, OVER])
		expect(reader.calls()).toBe(1)
	})

	// **The first edit past the window re-reads** — the context has grown a turn on, so the stored value
	// is no longer trusted.
	it('reads afresh once the window has passed', () => {
		const first = counting_reader(UNDER)
		const second = counting_reader(OVER)

		expect(implementation_cut_verdict.reused_verdict(first.read, DIRECTORY, NOW_MS)).toBe(UNDER)
		const later = implementation_cut_verdict.reused_verdict(second.read, DIRECTORY, NOW_MS + WINDOW)

		expect(later).toBe(OVER)
		expect(second.calls()).toBe(1)
	})

	// **A missing record reads afresh** — the cache miss every first edit of a fresh checkout takes.
	it('reads afresh when no record exists', () => {
		const reader = counting_reader(UNDER)

		expect(implementation_cut_verdict.reused_verdict(reader.read, DIRECTORY, NOW_MS)).toBe(UNDER)
		expect(reader.calls()).toBe(1)
	})
})
