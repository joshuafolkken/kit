import type { IssueState } from '#scripts/issue/issue-state'
import {
	PROCESS_ALIVE,
	PROCESS_NONE,
	PROCESS_UNKNOWN,
	type ProcessTrace,
} from '#scripts/run/run-liveness'
import { describe, expect, it, vi } from 'vitest'
import { lane_adopt, type AdoptPorts, type LaneFacts } from './lane-adopt'
import type { LaneInfo } from './lane-registry'
import type { LaneChange, LaneRecords, LaneStateRecord, RecordOutcome } from './lane-state'

// joshuafolkken/kit#4744: a restart lost the lane state records, and eight lanes holding uncommitted
// changes, unpushed commits or an open pull request read `no lane state — counted in use`.

const ISSUE = '4744'
const PULL = 4801
const UNPUSHED = 2
const DIRTY_STATUS = ' M scripts/lane/lane-adopt.ts\n'
const RECORD_EXISTS = 'a record exists'
const OPEN_ISSUE: IssueState = { state: 'OPEN', labels: ['in-progress'], is_human_review: false }
const NO_RECORDS: LaneRecords = new Map()

const LANE: LaneInfo = {
	issue: ISSUE,
	branch: `${ISSUE}-lane`,
	directory: `/lanes/${ISSUE}`,
	seat: 1,
	development_port: undefined,
	preview_port: undefined,
	output: `/tmp/${ISSUE}.log`,
	is_stranded: false,
}

const FACTS: LaneFacts = {
	branch: LANE.branch,
	is_dirty: true,
	unpushed: UNPUSHED,
	pull: { number: PULL, state: 'OPEN' },
	issue: OPEN_ISSUE,
}

async function written(change: LaneChange): Promise<RecordOutcome> {
	const record: LaneStateRecord = { ...change, changed_at: '', changed_by: change.command }

	return { kind: 'written', record }
}

async function unread(): Promise<undefined> {
	await Promise.resolve(undefined)
}

function ports_of(overrides: Partial<AdoptPorts> = {}): AdoptPorts {
	return {
		process_trace: vi.fn((): ProcessTrace => PROCESS_NONE),
		tree_status: vi.fn(async () => DIRTY_STATUS),
		unpushed_commits: vi.fn(async () => UNPUSHED),
		pull_request: vi.fn(async () => ({ pull: { number: PULL, state: 'OPEN' } })),
		issue: vi.fn(async () => OPEN_ISSUE),
		record: vi.fn(written),
		...overrides,
	}
}

// Adopt with `ports`, assert nothing was written, and answer why the lane was left.
async function left_by(ports: AdoptPorts, records = NO_RECORDS, lane = LANE): Promise<string> {
	const adoption = await lane_adopt.adopt(lane, records, ports)

	expect(ports.record).not.toHaveBeenCalled()

	return adoption.kind === 'left' ? adoption.reason : 'adopted'
}

describe('lane_adopt.adopt — every fact read', () => {
	it('records the lane open with its branch, changes, commits, pull request and issue', async () => {
		const ports = ports_of()

		const adoption = await lane_adopt.adopt(LANE, NO_RECORDS, ports)

		expect(ports.record).toHaveBeenCalledWith({
			issue: ISSUE,
			state: 'open',
			command: 'lane:adopt',
		})
		expect(adoption).toStrictEqual({ kind: 'adopted', facts: FACTS })
	})

	it('only reads the lane — its tree by status, its branch by name', async () => {
		const ports = ports_of()

		await lane_adopt.adopt(LANE, NO_RECORDS, ports)

		expect(ports.tree_status).toHaveBeenCalledWith(LANE.directory)
		expect(ports.unpushed_commits).toHaveBeenCalledWith(LANE.branch)
		expect(ports.pull_request).toHaveBeenCalledWith(LANE.branch)
	})

	it('leaves the lane unknown when the record is not written', async () => {
		const record = vi.fn(async () => ({ kind: 'skipped' as const, reason: RECORD_EXISTS }))

		const adoption = await lane_adopt.adopt(LANE, NO_RECORDS, ports_of({ record }))

		expect(adoption).toStrictEqual({ kind: 'left', reason: RECORD_EXISTS })
	})
})

describe('lane_adopt.facts_text', () => {
	it('says what it read', () => {
		const text = lane_adopt.facts_text(FACTS)

		expect(text).toContain('branch 4744-lane · uncommitted changes · 2 unpushed commit(s) · PR ')
		expect(text).toContain('4801')
		expect(text).toContain(' OPEN · issue OPEN (in-progress)')
		expect(lane_adopt.facts_text({ ...FACTS, is_dirty: false, pull: undefined })).toContain(
			'clean tree · 2 unpushed commit(s) · no PR',
		)
	})

	it('names a merged pull request as merged, not as the lane’s open one', () => {
		const merged = { ...FACTS, pull: { number: PULL, state: 'MERGED' } }

		expect(lane_adopt.facts_text(merged)).toContain(' MERGED · issue OPEN')
	})
})

describe('lane_adopt.adopt — nothing guessed', () => {
	it('leaves a lane whose child is working', async () => {
		const reason = await left_by(
			ports_of({ process_trace: vi.fn((): ProcessTrace => PROCESS_ALIVE) }),
		)

		expect(reason).toBe('a child is working in it')
	})

	it('leaves a lane whose process probe did not answer', async () => {
		const reason = await left_by(
			ports_of({ process_trace: vi.fn((): ProcessTrace => PROCESS_UNKNOWN) }),
		)

		expect(reason).toBe('its process probe did not answer')
	})

	it('leaves a lane whose facts could not all be read, naming each', async () => {
		const reason = await left_by(ports_of({ tree_status: unread, pull_request: unread }))

		expect(reason).toBe('could not read its work tree status, pull request')
	})

	it('leaves a lane whose issue could not be read', async () => {
		expect(await left_by(ports_of({ issue: unread }))).toBe('could not read its issue')
	})

	it('leaves a stranded lane', async () => {
		expect(await left_by(ports_of(), NO_RECORDS, { ...LANE, is_stranded: true })).toBe(
			'its work tree is gone',
		)
	})
})

describe('lane_adopt.adopt — a lane already recorded', () => {
	it('keeps a lane that already has a record, as known rather than unknown', async () => {
		const record: LaneStateRecord = {
			issue: ISSUE,
			state: 'running',
			changed_at: '',
			changed_by: 'lane:dispatch',
		}
		const ports = ports_of()

		const adoption = await lane_adopt.adopt(LANE, new Map([[ISSUE, record]]), ports)

		expect(adoption).toStrictEqual({ kind: 'kept', state: 'running' })
		expect(ports.record).not.toHaveBeenCalled()
	})
})
