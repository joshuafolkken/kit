import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_read } from './cost-audit-read'

const { prompt_line, request_line, record, session } = cost_audit_fixture

const FULLRUN_PROMPT = 'fullrun #1'
const LANE = '/p/-dev--kit-lanes-5936'
const MAIN_FILE = {
	session_id: 's1',
	path: '/p/-dev-kit/s1.jsonl',
	modified_ms: 1,
	is_delegated: false,
	depth: 0,
}

const GREP = { name: 'Grep', input: {} }
const EDIT = { name: 'Edit', input: {} }

describe('cost_audit_read.session_of — one transcript read into a session', () => {
	const text = [
		prompt_line(0, FULLRUN_PROMPT),
		request_line(1, 'r1', 1, [GREP]),
		request_line(1, 'r1', 1, [EDIT]),
		request_line(2, 'r2', 1),
	].join('\n')
	const read = cost_audit_read.session_of(text, false)

	it('reads the kind off the opening prompt', () => {
		expect(read.kind).toBe('fullrun')
	})

	it('folds the lines of one request into one record', () => {
		expect(read.records.map((one) => one.request_id)).toStrictEqual(['r1', 'r2'])
	})

	it("collects every call a request's lines issued under its id", () => {
		expect(read.categories.get('r1')).toStrictEqual(['code search', 'edit'])
		expect(read.categories.has('r2')).toBe(false)
	})

	// The lane-child density line reads only sessions marked here (kit#5342).
	it('marks a session read from a lane transcript as a lane child', () => {
		expect(read.is_lane).toBe(false)
		expect(cost_audit_read.session_of(text, false, true).is_lane).toBe(true)
	})

	// A delegated review's kind is `review`, not `subagent`, so only the delegation flag keeps it out.
	it('leaves a delegated unit in a lane transcript directory unmarked', () => {
		const review = [prompt_line(0, 'Run /code-review'), request_line(1, 'r1', 1, [GREP])].join('\n')

		expect(cost_audit_read.session_of(review, true, true).is_lane).toBe(false)
	})
})

// joshuafolkken/kit#5936: the phase table reads each lane transcript's stages by its Issue.
describe('cost_audit_read.issue_of — the lane a transcript was written under', () => {
	const lanes = [LANE, '/p/-dev--kit-lanes-12']

	it("reads a delegated unit's Issue off the lane directory above it", () => {
		const unit = `${LANE}/s1/subagents/agent-a1.jsonl`

		expect(cost_audit_read.issue_of(unit, lanes)).toBe(5936)
	})

	it('answers nothing for a transcript outside every lane', () => {
		expect(cost_audit_read.issue_of(MAIN_FILE.path, lanes)).toBeUndefined()
	})
})

describe('cost_audit_read.load — each session carries its lane', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('gives a lane transcript its Issue and leaves the main checkout one without', () => {
		const lane_file = { ...MAIN_FILE, session_id: 's2', path: `${LANE}/s2.jsonl` }

		vi.spyOn(cost_transcript, 'session_cwd').mockReturnValue('/dev/kit')
		vi.spyOn(cost_transcript, 'transcript_directories').mockReturnValue([])
		vi.spyOn(cost_transcript, 'list_sessions_across').mockReturnValue([lane_file, MAIN_FILE])
		vi.spyOn(cost_transcript, 'lane_transcript_directories').mockReturnValue([LANE])
		vi.spyOn(cost_transcript, 'read_raw').mockReturnValue(prompt_line(0, FULLRUN_PROMPT))

		const issues = cost_audit_read.load('/dev/kit', 0).map((one) => [one.issue, one.is_lane])

		expect(issues).toStrictEqual([
			[undefined, false],
			[5936, true],
		])
	})
})

// joshuafolkken/kit#5971: a delegated unit's agent type from the `meta.json` beside its transcript.
const make_directory = temporary_directory('suite')
const META_DIRECTORY = make_directory('cost-audit-meta-')

// A unit transcript's path in the fixture directory, a fixed `meta.json` written beside it when given.
function unit_path(id: string, meta: string | undefined): string {
	if (meta !== undefined) writeFileSync(path.join(META_DIRECTORY, `agent-${id}.meta.json`), meta)

	return path.join(META_DIRECTORY, `agent-${id}.jsonl`)
}

describe('cost_audit_read.agent_type_of — the meta.json beside a unit transcript', () => {
	it('reads the agent type a fixed meta.json names', () => {
		const meta = JSON.stringify({ agentType: 'reviewer', isBuiltIn: false, spawnDepth: 1 })

		expect(cost_audit_read.agent_type_of(unit_path('a1', meta))).toBe('reviewer')
	})

	it('answers nothing for a unit with no meta.json', () => {
		expect(cost_audit_read.agent_type_of(unit_path('a2', undefined))).toBeUndefined()
	})

	it('answers nothing for a meta.json that is not JSON or names no agent type', () => {
		expect(cost_audit_read.agent_type_of(unit_path('a3', '{'))).toBeUndefined()
		expect(cost_audit_read.agent_type_of(unit_path('a4', '{"agentType":""}'))).toBeUndefined()
	})
})

describe('cost_audit_read.load — a delegated unit carries its agent type', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('gives a loaded delegated unit its agent type and a main session none', () => {
		const meta = JSON.stringify({ agentType: 'investigator' })
		const unit_file = { ...MAIN_FILE, path: unit_path('a5', meta), is_delegated: true, depth: 1 }
		const main_file = { ...MAIN_FILE, session_id: 's9', path: unit_path('a6', meta) }

		vi.spyOn(cost_transcript, 'session_cwd').mockReturnValue('/dev/kit')
		vi.spyOn(cost_transcript, 'transcript_directories').mockReturnValue([])
		vi.spyOn(cost_transcript, 'list_sessions_across').mockReturnValue([unit_file, main_file])
		vi.spyOn(cost_transcript, 'lane_transcript_directories').mockReturnValue([])
		vi.spyOn(cost_transcript, 'read_raw').mockReturnValue(prompt_line(0, FULLRUN_PROMPT))

		const types = cost_audit_read.load('/dev/kit', 0).map((one) => one.agent_type)

		expect(types).toStrictEqual([undefined, 'investigator'])
	})
})

describe('cost_audit_read.dedupe_across — a request is counted once across sessions', () => {
	it('keeps a request in the first session that holds it', () => {
		const first = session('fullrun', [record('r1', 1, 1)])
		const resumed = session('resume', [record('r1', 1, 1), record('r2', 2, 1)])
		const [kept_first, kept_resumed] = cost_audit_read.dedupe_across([first, resumed])

		expect(kept_first?.records.map((one) => one.request_id)).toStrictEqual(['r1'])
		expect(kept_resumed?.records.map((one) => one.request_id)).toStrictEqual(['r2'])
	})
})
