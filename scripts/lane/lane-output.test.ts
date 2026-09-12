import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1713: where a lane's unit writes is recorded in the lane itself, so a session
// that never dispatched the child can poll it. Only `worktree_list` is stubbed here — the `.env`
// reads and writes are real, because "a second reading of the same disk finds it" is the whole
// claim under test and a mocked registry would assert nothing about it.
vi.mock('#scripts/git/git-worktree', () => ({ git_worktree: { worktree_list: vi.fn() } }))

const { git_worktree } = await import('#scripts/git/git-worktree')
const { lane_output } = await import('./lane-output')
const { lane_registry } = await import('./lane-registry')

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-output-test-'))
const MAIN_TREE = path.join(scratch, 'kit')
// What `lane_paths.default_lane_root(MAIN_TREE)` derives: a work tree counts as a lane only when it
// sits at `<lane root>/<issue>`.
const LANE_ROOT = path.join(scratch, '.kit-lanes')
const ISSUE = '1713'
const OTHER_ISSUE = '9999'
const LANE_DIRECTORY = path.join(LANE_ROOT, ISSUE)
const ENV_FILE = path.join(LANE_DIRECTORY, '.env')
const SEAT = 6
const SEAT_LINE = 'JOSH_LANE_SEAT=6\n'
const UNIT_FILE_NAME = 'agent-7.jsonl'
const UNIT_OUTPUT = path.join(scratch, UNIT_FILE_NAME)
const LATER_OUTPUT = path.join(scratch, 'agent-8.jsonl')
// Absolute, and outside every root `run:liveness` will read — so recording it would buy a lane that
// polls `undetermined` for ever.
const OUTSIDE_ROOTS = '/opt/kit-lanes/agent-7.jsonl'
const HEAD_LINE = 'HEAD 0000000000000000000000000000000000000000'
const SINGLE_RECORD = 1

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function block(directory: string, branch: string): string {
	return [`worktree ${directory}`, HEAD_LINE, `branch refs/heads/${branch}`].join('\n')
}

// git always names the main work tree first, and that first block is where the lane root is read
// from — so every fixture carries it.
function list_of(...blocks: ReadonlyArray<string>): void {
	const listing = [block(MAIN_TREE, 'main'), ...blocks].join('\n\n')

	vi.mocked(git_worktree.worktree_list).mockResolvedValue(`${listing}\n`)
}

function open_lane_on_disk(content: string | undefined): void {
	rmSync(LANE_DIRECTORY, { force: true, recursive: true })
	mkdirSync(LANE_DIRECTORY, { recursive: true })

	if (content !== undefined) writeFileSync(ENV_FILE, content)

	list_of(block(LANE_DIRECTORY, `${ISSUE}-lane`))
}

function recorded_lines(): Array<string> {
	return readFileSync(ENV_FILE, 'utf8')
		.split('\n')
		.filter((line) => line.includes('JOSH_LANE_OUTPUT'))
}

beforeEach(() => {
	open_lane_on_disk(SEAT_LINE)
})

describe('recording where a lane’s unit writes', () => {
	it('records the path and reads it back', async () => {
		await expect(lane_output.record_output(ISSUE, UNIT_OUTPUT)).resolves.toMatchObject({
			kind: 'recorded',
			output: UNIT_OUTPUT,
		})

		await expect(lane_output.read_output(ISSUE)).resolves.toMatchObject({
			kind: 'read',
			output: UNIT_OUTPUT,
		})
	})

	// The whole of joshuafolkken/kit#1713: the record lives in the lane rather than in the session
	// that opened it, so a fresh session — which has nothing but a second reading of the same disk —
	// can pick up a lane it never dispatched instead of waiting for the pool to drain.
	it('is readable by a session that did not open the lane', async () => {
		await lane_output.record_output(ISSUE, UNIT_OUTPUT)

		const lanes = await lane_registry.list_lanes()

		expect(lanes.map((lane) => lane.output)).toEqual([UNIT_OUTPUT])
	})

	it('leaves the port seat the same file carries untouched', async () => {
		await lane_output.record_output(ISSUE, UNIT_OUTPUT)

		const [lane] = await lane_registry.list_lanes()

		expect(lane?.seat).toBe(SEAT)
	})

	it('answers none for a lane whose child has not been handed over yet', async () => {
		await expect(lane_output.read_output(ISSUE)).resolves.toMatchObject({ kind: 'none' })
	})
})

describe('re-recording an output path', () => {
	it('replaces an earlier record rather than appending a second one', async () => {
		await lane_output.record_output(ISSUE, UNIT_OUTPUT)
		await lane_output.record_output(ISSUE, LATER_OUTPUT)

		expect(recorded_lines()).toHaveLength(SINGLE_RECORD)
		await expect(lane_output.read_output(ISSUE)).resolves.toMatchObject({ output: LATER_OUTPUT })
	})

	it('keeps a path holding a space and a hash, which an unquoted value would cut short', async () => {
		const awkward = path.join(scratch, 'a b #c.jsonl')

		await lane_output.record_output(ISSUE, awkward)

		await expect(lane_output.read_output(ISSUE)).resolves.toMatchObject({ output: awkward })
	})
})

describe('what recording an output path refuses', () => {
	// `run:liveness` confines `--output` to absolute paths under the home and temp directories and
	// answers `undetermined` for anything else — an answer meaning "could not read", so a lane
	// recorded with one would poll as indeterminate for ever. The test is that command's own, so an
	// absolute path outside those roots is refused here too rather than only a relative one.
	it('refuses a relative path', async () => {
		await expect(lane_output.record_output(ISSUE, UNIT_FILE_NAME)).resolves.toMatchObject({
			kind: 'invalid',
		})
	})

	it('refuses an absolute path run:liveness would not read either', async () => {
		await expect(lane_output.record_output(ISSUE, OUTSIDE_ROOTS)).resolves.toMatchObject({
			kind: 'invalid',
		})
	})

	it('refuses a path holding a quote, which would end the assignment it is written as', async () => {
		const quoted = path.join(scratch, 'a"b.jsonl')

		await expect(lane_output.record_output(ISSUE, quoted)).resolves.toMatchObject({
			kind: 'invalid',
		})
	})

	// A fresh file would drop the port seat the same `.env` carries, and the lane would go back onto
	// the main work tree's own ports.
	it('refuses a lane whose .env cannot be read rather than writing a new one', async () => {
		open_lane_on_disk(undefined)

		await expect(lane_output.record_output(ISSUE, UNIT_OUTPUT)).resolves.toMatchObject({
			kind: 'unreadable',
		})
		expect(existsSync(ENV_FILE)).toBe(false)
	})
})

describe('an issue no lane is open for', () => {
	it('is refused on both the read and the write', async () => {
		await expect(lane_output.record_output(OTHER_ISSUE, UNIT_OUTPUT)).resolves.toEqual({
			kind: 'no-lane',
		})
		await expect(lane_output.read_output(OTHER_ISSUE)).resolves.toEqual({ kind: 'no-lane' })
	})
})

describe('what a refusal tells the caller', () => {
	it('names the port seat, so the fix is not to delete the file', () => {
		const message = lane_output.describe_refusal(
			{
				kind: 'unreadable',
				lane: {
					issue: ISSUE,
					branch: '',
					directory: LANE_DIRECTORY,
					seat: undefined,
					development_port: undefined,
					preview_port: undefined,
					output: undefined,
					is_stranded: false,
				},
			},
			ISSUE,
		)

		expect(message).toContain('port seat')
	})
})
