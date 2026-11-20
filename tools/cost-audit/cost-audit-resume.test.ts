import { lane_child_invocation } from '#scripts/lane/lane-child-invocation'
import {
	time_transcript_line,
	type TranscriptLine,
} from '#scripts/time-runtime/time-transcript-line'
import { describe, expect, it } from 'vitest'
import { cost_audit_fixture } from './cost-audit-fixture'
import type { AuditSession } from './cost-audit-read'
import { cost_audit_resume } from './cost-audit-resume'

const { record, request_line, session } = cost_audit_fixture
const { CUT, IMPLEMENT_CUT, SHIP_STOP, UNKNOWN } = cost_audit_resume

const ISSUE = '8311'
const PRE_GATE = `pnpm josh run:cut ${ISSUE}`
const IMPL = `pnpm josh run:cut ${ISSUE} --impl --handoff .josh/tmp/handoff-${ISSUE}.json`
const RESUMED = 'resume'

// One Bash call per command, in order, read back as transcript lines.
function lines_of(...commands: ReadonlyArray<string>): Array<TranscriptLine> {
	return commands.flatMap((command, index) => {
		const raw = request_line(index, `r${String(index)}`, 1, [{ name: 'Bash', input: { command } }])
		const line = time_transcript_line.parse_line(raw)

		return line === undefined ? [] : [line]
	})
}

function lane_session(kind: string, extra: Partial<AuditSession> = {}): AuditSession {
	return { ...session(kind, [record(kind, 1, 1)], [], true), issue: Number(ISSUE), ...extra }
}

describe('cost_audit_resume.prompt_trigger — the trigger an opening prompt names', () => {
	it('names an API outage and a ship stop off the prompts the lane launcher writes', () => {
		const outage = lane_child_invocation.outage_resume_invocation(ISSUE)
		const stop = lane_child_invocation.ship_stop_invocation(ISSUE)

		expect(cost_audit_resume.prompt_trigger(RESUMED, outage)).toBe(cost_audit_resume.OUTAGE)
		expect(cost_audit_resume.prompt_trigger(RESUMED, stop)).toBe(SHIP_STOP)
	})

	it('leaves a cut resume for the session before it to place', () => {
		const prompt = lane_child_invocation.resume_invocation(ISSUE)

		expect(cost_audit_resume.prompt_trigger(RESUMED, prompt)).toBe(CUT)
	})

	it('counts a resume prompt it cannot read as unknown and gives other kinds none', () => {
		expect(cost_audit_resume.prompt_trigger(RESUMED, 'Resuming something else')).toBe(UNKNOWN)
		expect(cost_audit_resume.prompt_trigger('fullrun', 'fullrun #1')).toBeUndefined()
	})
})

describe('cost_audit_resume.cut_trigger — the cut the session before ended on', () => {
	it('reads a cut without --impl as the pre-gate cut', () => {
		const lines = lines_of(`pnpm josh run:step ${ISSUE}`, PRE_GATE)

		expect(cost_audit_resume.cut_trigger(lines)).toBe(cost_audit_resume.PRE_GATE_CUT)
	})

	it('reads an --impl cut with no review before it as an implementation cut', () => {
		expect(cost_audit_resume.cut_trigger(lines_of(IMPL))).toBe(IMPLEMENT_CUT)
	})

	it('reads an --impl cut after a review command as the review-fix cut', () => {
		const lines = lines_of(`pnpm josh run:chain ${ISSUE}`, IMPL)

		expect(cost_audit_resume.cut_trigger(lines)).toBe(cost_audit_resume.REVIEW_FIX_CUT)
	})

	it('answers unknown for a session with no cut, a resume read not counting', () => {
		const lines = lines_of(`pnpm josh run:cut --resume ${ISSUE}`)

		expect(cost_audit_resume.cut_trigger(lines)).toBe(UNKNOWN)
		expect(cost_audit_resume.cut_trigger([])).toBe(UNKNOWN)
	})
})

describe("cost_audit_resume.with_triggers — a cut resume placed by its lane's session before", () => {
	it('places a cut resume by the last lane child session, a lane reviewer skipped', () => {
		const child = lane_session('fullrun', { lines: lines_of(IMPL) })
		const reviewer = lane_session('review')
		const resume = lane_session(RESUMED, { trigger: CUT })
		const placed = cost_audit_resume.with_triggers([child, reviewer, resume])

		expect(placed.map((one) => one.trigger)).toStrictEqual([undefined, undefined, IMPLEMENT_CUT])
	})

	it('counts a cut resume with no session before it as unknown', () => {
		const placed = cost_audit_resume.with_triggers([lane_session(RESUMED, { trigger: CUT })])

		expect(placed[0]?.trigger).toBe(UNKNOWN)
	})
})

function resumed(id: string, usd: number, trigger?: string): AuditSession {
	return { ...session(RESUMED, [record(id, 1, usd)]), trigger }
}

describe('cost_audit_resume.rows_of — sessions and dollars per trigger, both periods', () => {
	const current = [
		resumed('a', 2, SHIP_STOP),
		resumed('b', 1, SHIP_STOP),
		resumed('c', 1),
		session('fullrun', [record('d', 1, 5)]),
	]
	const rows = cost_audit_resume.rows_of(current, [resumed('e', 1, SHIP_STOP)])

	it('lists every trigger in a fixed order, a zero one included', () => {
		expect(rows.map((one) => one.key)).toStrictEqual([
			IMPLEMENT_CUT,
			cost_audit_resume.PRE_GATE_CUT,
			cost_audit_resume.REVIEW_FIX_CUT,
			cost_audit_resume.OUTAGE,
			SHIP_STOP,
			UNKNOWN,
		])
	})

	it("sums a trigger's sessions and dollars in each period, other kinds left out", () => {
		expect(rows.find((one) => one.key === SHIP_STOP)).toStrictEqual({
			key: SHIP_STOP,
			current: { sessions: 2, usd: 3 },
			previous: { sessions: 1, usd: 1 },
		})
	})

	it('counts a resume with no trigger as unknown', () => {
		expect(rows.find((one) => one.key === UNKNOWN)?.current).toStrictEqual({ sessions: 1, usd: 1 })
	})
})
