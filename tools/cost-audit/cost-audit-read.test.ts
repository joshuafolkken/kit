import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { lane_child_invocation } from '#scripts/lane/lane-child-invocation'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_read } from './cost-audit-read'

const { prompt_line, request_line, record, session } = cost_audit_fixture

const FULLRUN_PROMPT = 'fullrun #1'
const OUTAGE_PROMPT = lane_child_invocation.outage_resume_invocation('1')
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

	it('keeps the opening prompt for the reviewer trigger table', () => {
		expect(read.prompt).toBe(FULLRUN_PROMPT)
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

// joshuafolkken/kit#8311: why a resume session was started, read off its user prompts.
const OUTAGE_RESUME = ['resume', 'API outage']
const FULLRUN = ['fullrun', undefined]

function kind_and_trigger(lines: ReadonlyArray<string>): Array<string | undefined> {
	const read = cost_audit_read.session_of(lines.join('\n'), false, true)

	return [read.kind, read.trigger]
}

describe('cost_audit_read.session_of — the trigger of a resume session', () => {
	it('gives a resume session its trigger and a run session none', () => {
		expect(kind_and_trigger([prompt_line(0, OUTAGE_PROMPT)])).toStrictEqual(OUTAGE_RESUME)
		expect(kind_and_trigger([prompt_line(0, FULLRUN_PROMPT)])).toStrictEqual(FULLRUN)
	})

	// The outage relaunch resumes the stopped session, so its prompt follows the opening fullrun one.
	it('reads an outage prompt after the opening fullrun prompt as an outage resume', () => {
		const relaunched = [
			prompt_line(0, FULLRUN_PROMPT),
			request_line(1, 'r1', 1, [GREP]),
			prompt_line(2, OUTAGE_PROMPT),
		]

		expect(kind_and_trigger(relaunched)).toStrictEqual(OUTAGE_RESUME)
	})

	it('keeps the opening prompt the kind when a later prompt names no outage', () => {
		const later = [prompt_line(0, FULLRUN_PROMPT), prompt_line(1, 'carry on')]

		expect(kind_and_trigger(later)).toStrictEqual(FULLRUN)
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

// The store listing `files`, newest first, under the one lane `LANE`.
function stub_lane_files(files: Array<SessionFile>): void {
	vi.spyOn(cost_transcript, 'session_cwd').mockReturnValue('/dev/kit')
	vi.spyOn(cost_transcript, 'transcript_directories').mockReturnValue([])
	vi.spyOn(cost_transcript, 'list_sessions_across').mockReturnValue(files)
	vi.spyOn(cost_transcript, 'lane_transcript_directories').mockReturnValue([LANE])
}

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

	// joshuafolkken/kit#8311: a cut resume is placed by the lane's session before it once all are read.
	it("places a lane's cut resume by the lane session read before it", () => {
		const first = { ...MAIN_FILE, session_id: 's2', path: `${LANE}/s2.jsonl`, modified_ms: 1 }
		const second = { ...first, session_id: 's3', path: `${LANE}/s3.jsonl`, modified_ms: 2 }
		const cut = { name: 'Bash', input: { command: 'pnpm josh run:cut 5936' } }
		const texts = new Map([
			[first.path, [prompt_line(0, FULLRUN_PROMPT), request_line(1, 'r1', 1, [cut])].join('\n')],
			[second.path, prompt_line(2, lane_child_invocation.resume_invocation('5936'))],
		])

		stub_lane_files([second, first])
		vi.spyOn(cost_transcript, 'read_raw').mockImplementation((file) => texts.get(file.path) ?? '')

		const triggers = cost_audit_read.load('/dev/kit', 0).map((one) => one.trigger)

		expect(triggers).toStrictEqual([undefined, 'pre-gate cut'])
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

// joshuafolkken/kit#8284: `--density` opens the lane children's own transcripts alone.
const LANE_FILE = { ...MAIN_FILE, session_id: 's2', path: `${LANE}/s2.jsonl`, modified_ms: 5 }
const STORE = [
	LANE_FILE,
	{ ...LANE_FILE, session_id: 's3', path: `${LANE}/s3.jsonl`, modified_ms: 1 },
	{ ...LANE_FILE, path: `${LANE}/s2/a.jsonl`, is_delegated: true, depth: 1 },
	{ ...MAIN_FILE, modified_ms: 5 },
]

// The store stubbed to `STORE` under the one lane `LANE`, answering the spy every file read goes through.
function stub_store(): MockInstance<typeof cost_transcript.read_raw> {
	vi.spyOn(cost_transcript, 'session_cwd').mockReturnValue('/dev/kit')
	vi.spyOn(cost_transcript, 'transcript_directories').mockReturnValue([])
	vi.spyOn(cost_transcript, 'list_sessions_across').mockReturnValue(STORE)
	vi.spyOn(cost_transcript, 'lane_transcript_directories').mockReturnValue([LANE])

	return vi.spyOn(cost_transcript, 'read_raw').mockReturnValue(prompt_line(0, FULLRUN_PROMPT))
}

describe('cost_audit_read.load_lane_children — only lane children are opened', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('opens no main checkout, delegated unit or pre-since transcript', () => {
		const read = stub_store()
		const sessions = cost_audit_read.load_lane_children('/dev/kit', 3)
		const lane_file = LANE_FILE

		expect(read.mock.calls.map(([file]) => file.path)).toStrictEqual([lane_file.path])
		expect(sessions.map((one) => [one.issue, one.is_lane])).toStrictEqual([[5936, true]])
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
