import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import type { EndedRun } from '#scripts/run/carry/run-carry-ended'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read_fixture } from './run-board-read-fixture'
import { run_board_single } from './run-board-single'
import type { BoardSpan } from './run-board-span'
import { run_board_span_read } from './run-board-span-read'

// joshuafolkken/kit#7522: the span read `run:board` draws its run by, split out of `run-board-read.ts`.

const { CARRY, ENDED_AT, REPOSITORY, arrange } = run_board_read_fixture
const STARTED_AT = '2026-10-08T09:00:00.000Z'
const NONE: CarryRead = { kind: 'none' }
const TRANSCRIPT = '/home/.claude/projects/kit/session.jsonl'
const STOPPED: EndedRun = {
	invocation: 'backlogrun #3431 --only',
	started_at: STARTED_AT,
	ended_at: ENDED_AT,
	stopped: 'decision',
	session: 'abc',
}
const SINGLE: BoardSpan = {
	invocation: 'fullrun #7522',
	started_ms: Date.parse(STARTED_AT),
	ended_ms: undefined,
}
const NO_SPAN = {
	span: undefined,
	resume: undefined,
	transcript: undefined,
	roots: {},
	carry: undefined,
	is_stranded: false,
	is_session_active: false,
}

afterEach(() => vi.restoreAllMocks())

describe('run_board_span_read.span_here — no run', () => {
	it('reads no span where there is no repository', async () => {
		await expect(run_board_span_read.span_here(undefined, undefined)).resolves.toStrictEqual(
			NO_SPAN,
		)
	})

	it('reads no span where no run has started or ended', async () => {
		arrange(NONE, undefined)

		await expect(run_board_span_read.span_here(REPOSITORY, undefined)).resolves.toStrictEqual(
			NO_SPAN,
		)
	})
})

describe('run_board_span_read.span_here — a single run', () => {
	it('draws the single run this checkout holds and names no process', async () => {
		arrange({ kind: 'carried', carry: CARRY }, STOPPED)
		vi.spyOn(run_board_single, 'span_here').mockResolvedValue(SINGLE)

		await expect(run_board_span_read.span_here(REPOSITORY, undefined)).resolves.toStrictEqual({
			...NO_SPAN,
			span: SINGLE,
		})
	})
})

describe('run_board_span_read.span_here — the run’s record', () => {
	it('reads the stopped run with the session it resumes from', async () => {
		arrange(NONE, STOPPED)

		await expect(run_board_span_read.span_here(REPOSITORY, undefined)).resolves.toMatchObject({
			span: { started_ms: Date.parse(STARTED_AT), ended_ms: Date.parse(ENDED_AT) },
			resume: 'abc',
			carry: undefined,
		})
	})

	it('reads the carried run’s record and its parent’s transcript', async () => {
		const carry = { ...CARRY, owner_transcript: TRANSCRIPT }

		arrange({ kind: 'carried', carry }, undefined)

		await expect(run_board_span_read.span_here(REPOSITORY, undefined)).resolves.toMatchObject({
			carry,
			transcript: TRANSCRIPT,
			resume: undefined,
		})
		expect(run_carry.read_carry).toHaveBeenCalledWith(run_carry.carry_path(REPOSITORY))
	})

	it('reads whether the run is stranded from the repository’s records', async () => {
		arrange(NONE, STOPPED)
		const is_stranded_at = vi.spyOn(run_stranded_detect, 'is_stranded_at').mockReturnValue(true)

		await expect(run_board_span_read.span_here(REPOSITORY, undefined)).resolves.toMatchObject({
			is_stranded: true,
		})
		expect(is_stranded_at).toHaveBeenCalledWith(REPOSITORY, expect.any(Object))
	})
})
