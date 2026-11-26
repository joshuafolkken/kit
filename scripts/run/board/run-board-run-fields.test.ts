import type { LaneInfo } from '#scripts/lane/lane-registry'
import { run_wake } from '#scripts/run/wake/run-wake'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_operation_read } from './run-board-operation-read'
import { run_board_run_fields, type RunSpan } from './run-board-run-fields'
import { run_board_scope } from './run-board-scope'
import { run_board_throughput } from './run-board-throughput'

const REPOSITORY = '/repo'
const TRANSCRIPT = '/sessions/owner.jsonl'
const STARTED_MS = 1000

function lane_of(issue: string): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: `/lanes/${issue}/dispatch.log`,
		is_stranded: false,
	}
}

const LANES: ReadonlyArray<LaneInfo> = [lane_of('101'), lane_of('102')]

const READ: RunSpan = {
	span: { started_ms: STARTED_MS, ended_ms: undefined, invocation: 'backlogrun' },
	resume: undefined,
	transcript: TRANSCRIPT,
	roots: {},
	carry: undefined,
	is_stranded: false,
	is_session_active: true,
}

const SINGLE_TRANSCRIPT = '/sessions/single.jsonl'

// A root checkout's single run as its hold draws it, running unless `ended_ms` is given.
function single_span(ended_ms?: number): RunSpan['span'] {
	return {
		started_ms: STARTED_MS,
		ended_ms,
		invocation: 'fullrun #8482',
		transcript: SINGLE_TRANSCRIPT,
	}
}

const SINGLE_SOURCE = { issue: '8482', log: SINGLE_TRANSCRIPT, root: process.cwd() }

afterEach(() => vi.restoreAllMocks())

describe('run_board_run_fields.sources_of', () => {
	it('names each lane, the owner and the judgment session with their logs and checkouts', () => {
		const root = process.cwd()

		expect(run_board_run_fields.sources_of(REPOSITORY, LANES, READ)).toEqual({
			lanes: [
				{ issue: '101', log: '/lanes/101/dispatch.log', root: '/lanes/101' },
				{ issue: '102', log: '/lanes/102/dispatch.log', root: '/lanes/102' },
			],
			owner: { log: TRANSCRIPT, root },
			judgment: { log: run_wake.wake_log_path(REPOSITORY), root },
		})
	})

	it('leaves the owner log unset where the record names no transcript', () => {
		const read = { ...READ, transcript: undefined }

		expect(run_board_run_fields.sources_of(REPOSITORY, [], read).owner.log).toBeUndefined()
	})

	it("reads the root checkout's running single run beside the lanes from its transcript", () => {
		const read = { ...READ, singles: [single_span()] }

		expect(run_board_run_fields.sources_of(REPOSITORY, LANES, read).lanes).toContainEqual(
			SINGLE_SOURCE,
		)
	})

	it('reads a single run drawn alone, with no carry and no lane, from its transcript', () => {
		const read = { ...READ, span: single_span(), transcript: undefined }

		expect(run_board_run_fields.sources_of(REPOSITORY, [], read).lanes).toEqual([SINGLE_SOURCE])
	})

	it('reads no operation of a single run a stop ended', () => {
		const read = { ...READ, span: single_span(STARTED_MS), transcript: undefined }

		expect(run_board_run_fields.sources_of(REPOSITORY, [], read).lanes).toEqual([])
	})
})

describe('run_board_run_fields.fields_of', () => {
	it('lists the lanes by issue and reads the operations off the run sources', () => {
		const read = vi.spyOn(run_board_operation_read, 'read').mockReturnValue(undefined as never)
		const fields = run_board_run_fields.fields_of(REPOSITORY, READ, LANES, [])

		expect(fields.lanes).toEqual(['101', '102'])
		expect(read).toHaveBeenCalledWith(run_board_run_fields.sources_of(REPOSITORY, LANES, READ))
	})

	it("keeps the root checkout's single run out of the lanes it lists", () => {
		vi.spyOn(run_board_operation_read, 'read').mockReturnValue(undefined as never)

		const fields = run_board_run_fields.fields_of(
			REPOSITORY,
			{ ...READ, singles: [single_span()] },
			LANES,
			[],
		)

		expect(fields.lanes).toEqual(['101', '102'])
	})

	it('carries the span record fields and derives the scope and throughput', () => {
		vi.spyOn(run_board_operation_read, 'read').mockReturnValue(undefined as never)
		vi.spyOn(run_board_throughput, 'rows_of').mockReturnValue([])

		expect(run_board_run_fields.fields_of(REPOSITORY, READ, LANES, [])).toEqual({
			scope: run_board_scope.scope_of('backlogrun'),
			throughput: [],
			lanes: ['101', '102'],
			resume: undefined,
			roots: {},
			carry: undefined,
			is_stranded: false,
			is_session_active: true,
			operations: undefined,
		})
	})
})
