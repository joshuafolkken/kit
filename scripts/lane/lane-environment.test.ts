import { describe, expect, it } from 'vitest'
import { lane_environment } from './lane-environment'

// joshuafolkken/kit#1490: the acceptance condition this file carries is that a lane gets **its own**
// `PORT_SEED` while everything else in the root's `.env` reaches it unchanged. A lane that inherited
// the seed verbatim would put every lane on one pair of ports, and a busy port fails without
// retrying — at the default six lanes that is E2E failing nearly always, not occasionally.

const COMMENT = '# personal, non-committed'
const BOT_TOKEN = 'TELEGRAM_BOT_TOKEN=abc:123'
const CHAT_ID = 'TELEGRAM_CHAT_ID=42'
const SESSION_LANG = 'JOSH_SESSION_LANG=ja'
const ROOT_SEED_LINE = 'PORT_SEED=5'
const ROOT_FILE = [COMMENT, BOT_TOKEN, CHAT_ID, ROOT_SEED_LINE, SESSION_LANG, ''].join('\n')
const ROOT_SEED = 5
const LANE_SEAT = 3
const SEAT_LINE = 'JOSH_LANE_SEAT=3'
const DEV_BASE = 5173
const PREVIEW_BASE = 4173
const SEED_MULTIPLIER = 10

describe('the lane .env', () => {
	it('carries every key across untouched, and keeps the project seed', () => {
		const content = lane_environment.lane_file_content(ROOT_FILE, LANE_SEAT)

		expect(content).toContain(COMMENT)
		expect(content).toContain(BOT_TOKEN)
		expect(content).toContain(CHAT_ID)
		expect(content).toContain(SESSION_LANG)
		// The seed is the project's own and stays exactly as it was — only the seat distinguishes a lane.
		expect(content).toContain(ROOT_SEED_LINE)
	})

	it('adds the seat as its own key, so the file shows seed and seat apart', () => {
		const content = lane_environment.lane_file_content(ROOT_FILE, LANE_SEAT)
		const seat_lines = content.split('\n').filter((line) => lane_environment.is_seat_line(line))

		expect(seat_lines).toStrictEqual([SEAT_LINE])
	})

	it('replaces the seat in place rather than appending a second one', () => {
		const already = `${ROOT_SEED_LINE}\nJOSH_LANE_SEAT=1\n`
		const content = lane_environment.lane_file_content(already, LANE_SEAT)
		const seat_lines = content.split('\n').filter((line) => lane_environment.is_seat_line(line))

		expect(seat_lines).toStrictEqual([SEAT_LINE])
	})

	it('appends the seat to a root file that had none', () => {
		const content = lane_environment.lane_file_content(`${CHAT_ID}\n`, LANE_SEAT)

		expect(content).toBe(`${CHAT_ID}\n${SEAT_LINE}\n`)
	})

	it('writes the seat even when the root has no .env at all', () => {
		expect(lane_environment.lane_file_content('', LANE_SEAT)).toBe(`${SEAT_LINE}\n`)
	})
})

describe('reading the root seed every lane is offset from', () => {
	it('reads the seed the root set', () => {
		expect(lane_environment.read_root_seed(ROOT_FILE)).toBe(ROOT_SEED)
	})

	it('reads a quoted value without its quotes', () => {
		expect(lane_environment.read_root_seed('PORT_SEED="5"\n')).toBe(ROOT_SEED)
	})

	it('reads a missing or blank seed as 0, the documented default', () => {
		expect(lane_environment.read_root_seed('')).toBe(0)
		expect(lane_environment.read_root_seed('PORT_SEED=\n')).toBe(0)
	})

	// `.env` is last-wins, so a root that kept the blank key from `.env.example` and appended a real
	// seed later would otherwise read as 0 here and as the real seed everywhere else — and the lane
	// band would run straight over the main work tree's own ports.
	it('takes the last assignment, the way every other reader of .env does', () => {
		expect(lane_environment.read_root_seed(`PORT_SEED=\n${ROOT_SEED_LINE}\n`)).toBe(ROOT_SEED)
	})

	// A silent fallback to 0 would put the lane on the root's own ports, which is the one outcome
	// this module exists to prevent — so the validation is `ports.resolve_seed`'s, not a copy of it.
	it('throws on a malformed seed rather than falling back', () => {
		expect(() => lane_environment.read_root_seed('PORT_SEED=abc\n')).toThrow('PORT_SEED')
	})
})

describe('reading a lane’s seat and the ports it resolves to', () => {
	it('reads the seat the lane records', () => {
		expect(lane_environment.read_lane_seat(`${ROOT_SEED_LINE}\n${SEAT_LINE}\n`)).toBe(LANE_SEAT)
	})

	// A file with no seat line is undefined, never seat 0 — seat 0 is the main work tree's own, so a
	// lane read as sharing it would be booked over while it still runs on its own ports.
	it('reads a file with no seat line as undefined, never as seat 0', () => {
		expect(lane_environment.read_lane_seat(ROOT_FILE)).toBeUndefined()
	})

	it('throws on a malformed seat rather than falling back', () => {
		expect(() => lane_environment.read_lane_seat('JOSH_LANE_SEAT=abc\n')).toThrow('JOSH_LANE_SEAT')
	})

	// The ports come through `ports/index.js`, so they are `seed × 10 + seat` off the bases — the
	// same numbers the lane itself resolves, never a second formula here.
	it('resolves dev and preview from the seed and seat together', () => {
		const offset = ROOT_SEED * SEED_MULTIPLIER + LANE_SEAT

		expect(lane_environment.read_lane_ports(`${ROOT_SEED_LINE}\n${SEAT_LINE}\n`)).toStrictEqual({
			development: DEV_BASE + offset,
			preview: PREVIEW_BASE + offset,
		})
	})
})

// joshuafolkken/kit#1713: the lane also records where the unit running its child writes, in the same
// file and by the same last-wins rules, so a session that did not open the lane can poll that child.
const RECORDED_SEED = 6
const SEED_FILE = `PORT_SEED=${String(RECORDED_SEED)}\n`
const UNIT_OUTPUT = '/home/dev/.claude/projects/kit/session/subagents/agent-7.jsonl'
const LATER_UNIT_OUTPUT = '/home/dev/.claude/projects/kit/session/subagents/agent-8.jsonl'
const RECORDED_LINE = `JOSH_LANE_OUTPUT="${UNIT_OUTPUT}"`
const LATER_RECORDED_LINE = `JOSH_LANE_OUTPUT="${LATER_UNIT_OUTPUT}"`

describe('writing where a lane’s unit writes', () => {
	it('appends a quoted record to a file that had none', () => {
		expect(lane_environment.with_lane_output(SEED_FILE, UNIT_OUTPUT)).toBe(
			`${SEED_FILE}${RECORDED_LINE}\n`,
		)
	})

	it('replaces the record in place rather than leaving two of them', () => {
		const once = lane_environment.with_lane_output(SEED_FILE, UNIT_OUTPUT)

		expect(lane_environment.with_lane_output(once, LATER_UNIT_OUTPUT)).toBe(
			`${SEED_FILE}${LATER_RECORDED_LINE}\n`,
		)
	})

	it('leaves the seed the same file carries alone', () => {
		const content = lane_environment.with_lane_output(SEED_FILE, UNIT_OUTPUT)

		expect(lane_environment.read_root_seed(content)).toBe(RECORDED_SEED)
	})
})

describe('reading where a lane’s unit writes', () => {
	it('reads back what it wrote', () => {
		const content = lane_environment.with_lane_output('', UNIT_OUTPUT)

		expect(lane_environment.read_lane_output(content)).toBe(UNIT_OUTPUT)
	})

	// An unquoted value is cut at a ` #` by every dotenv reader, so the record would come back
	// truncated to something that still looks like a path.
	it('survives a path holding a space and a hash', () => {
		const awkward = '/home/dev/a b #c.jsonl'
		const content = lane_environment.with_lane_output('', awkward)

		expect(lane_environment.read_lane_output(content)).toBe(awkward)
	})

	it('reads an export-prefixed assignment, which dotenv readers accept', () => {
		const content = `export JOSH_LANE_OUTPUT=${UNIT_OUTPUT}\n`

		expect(lane_environment.read_lane_output(content)).toBe(UNIT_OUTPUT)
	})

	it('takes the last record, the way .env itself is last-wins', () => {
		const content = `${RECORDED_LINE}\n${LATER_RECORDED_LINE}\n`

		expect(lane_environment.read_lane_output(content)).toBe(LATER_UNIT_OUTPUT)
	})

	// A cleared record has nothing to poll, and an empty string handed to `run:liveness --output` is
	// a relative path — refused there, so the child would answer `undetermined` for ever.
	it('reads a missing or blank record as undefined, never as an empty path', () => {
		expect(lane_environment.read_lane_output(SEED_FILE)).toBeUndefined()
		expect(lane_environment.read_lane_output('JOSH_LANE_OUTPUT=\n')).toBeUndefined()
	})
})
