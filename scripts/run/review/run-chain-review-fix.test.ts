import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_cut_handoff } from '#scripts/run/cut/run-cut-handoff'
import { run_cut_ready } from '#scripts/run/cut/run-cut-ready'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_chain_review_fix } from './run-chain-review-fix'

const fs_mock = vi.hoisted(() => ({
	mkdirSync: vi.fn(),
	writeFileSync: vi.fn(),
}))

vi.mock(import('node:fs'), async (import_original) => ({
	...(await import_original()),
	...fs_mock,
}))

const ISSUE = '6900'
const FINDINGS = ['bug-risks:medium:scripts/a.ts — a bug', 'bug-risks:low:scripts/b.ts — a nit']
const HANDOFF_FILE = '.josh/tmp/handoff-6900.json'
const IN_PLACE = 'fix each finding, record, then ship'

function fix_next(issue: string): string {
	return `${IN_PLACE} #${issue}`
}

function in_lane(is_child: boolean, is_dirty = true): void {
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(is_child)
	vi.spyOn(run_cut_ready, 'is_ready_sync').mockReturnValue(is_dirty)
}

function written(): string {
	return String(fs_mock.writeFileSync.mock.calls[0]?.[1])
}

beforeEach(() => {
	fs_mock.mkdirSync.mockReset()
	fs_mock.writeFileSync.mockReset()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_chain_review_fix.route — a lane child (ac-c38296ce)', () => {
	it('asks for the implementation cut that hands the fix to a fresh session', () => {
		in_lane(true)

		const next = run_chain_review_fix.route(ISSUE, FINDINGS, fix_next)(ISSUE)

		expect(next).toContain(`\`pnpm josh run:cut 6900 --impl --handoff ${HANDOFF_FILE}\` alone`)
		expect(next).toContain('end the turn on `cut`')
		expect(next).toContain(`on any other verdict, ${IN_PLACE} #6900`)
	})

	it('writes a complete handoff carrying the findings and the steps after the fix', () => {
		in_lane(true)

		run_chain_review_fix.route(ISSUE, FINDINGS, fix_next)

		expect(fs_mock.writeFileSync.mock.calls[0]?.[0]).toBe(HANDOFF_FILE)
		expect(fs_mock.mkdirSync).toHaveBeenCalledWith('.josh/tmp', { recursive: true })

		const handoff = run_cut_handoff.parse_handoff(written())

		expect(run_cut_handoff.is_complete_handoff(handoff)).toBe(true)
		expect(handoff?.instruction).toBe('fullrun #6900')
		expect(handoff?.remaining).toStrictEqual([`${IN_PLACE} #6900`])
		expect(run_cut_handoff.carried_findings(handoff)).toStrictEqual(FINDINGS)
	})
})

describe('run_chain_review_fix.route — the fix stays in place', () => {
	it('outside a lane, writing no handoff', () => {
		in_lane(false)

		expect(run_chain_review_fix.route(ISSUE, FINDINGS, fix_next)).toBe(fix_next)
		expect(fs_mock.writeFileSync).not.toHaveBeenCalled()
	})

	it('on a tree the run:review open committed, where the cut answers unready', () => {
		in_lane(true, false)

		expect(run_chain_review_fix.route(ISSUE, FINDINGS, fix_next)).toBe(fix_next)
		expect(fs_mock.writeFileSync).not.toHaveBeenCalled()
	})

	it('where the handoff cannot be written', () => {
		in_lane(true)
		fs_mock.writeFileSync.mockImplementation(() => {
			throw new Error('read-only file system')
		})

		expect(run_chain_review_fix.route(ISSUE, FINDINGS, fix_next)).toBe(fix_next)
	})
})
