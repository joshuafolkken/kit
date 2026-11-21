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

afterEach(() => vi.restoreAllMocks())

describe('run_board_run_fields.sources_of', () => {
	it('names each lane, the owner and the judgment session with their logs and checkouts', () => {
		const root = process.cwd()

		expect(run_board_run_fields.sources_of(REPOSITORY, LANES, TRANSCRIPT)).toEqual({
			lanes: [
				{ issue: '101', log: '/lanes/101/dispatch.log', root: '/lanes/101' },
				{ issue: '102', log: '/lanes/102/dispatch.log', root: '/lanes/102' },
			],
			owner: { log: TRANSCRIPT, root },
			judgment: { log: run_wake.wake_log_path(REPOSITORY), root },
		})
	})

	it('leaves the owner log unset where the record names no transcript', () => {
		expect(run_board_run_fields.sources_of(REPOSITORY, [], undefined).owner.log).toBeUndefined()
	})
})

describe('run_board_run_fields.fields_of', () => {
	it('lists the lanes by issue and reads the operations off the run sources', () => {
		const read = vi.spyOn(run_board_operation_read, 'read').mockReturnValue(undefined as never)
		const fields = run_board_run_fields.fields_of(REPOSITORY, READ, LANES, [])

		expect(fields.lanes).toEqual(['101', '102'])
		expect(read).toHaveBeenCalledWith(
			run_board_run_fields.sources_of(REPOSITORY, LANES, TRANSCRIPT),
		)
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
