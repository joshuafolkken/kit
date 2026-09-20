import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { run_event_stream } from './run-event-stream'

// joshuafolkken/kit#2205: the append-only, ordered event stream. The pure module takes an explicit
// target, so the tests write to a temp file rather than resolving a run identity — the emit side is
// tested separately. Each acceptance criterion the stream itself carries is pinned here: monotonic
// positions, a positioned read, the degenerate last read, the bound and what it drops, and the refusal
// of a kind outside the one enumeration.

const KIND = run_event_stream.EVENT_KIND
const AT = '2026-09-21T00:00:00.000Z'
const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-event-stream-'))

function fresh_target(): string {
	return path.join(TEMPORARY, `${randomUUID()}.jsonl`)
}

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

describe('run_event_stream.append — positions', () => {
	it('assigns a monotonically increasing position to each event', () => {
		const target = fresh_target()

		expect(run_event_stream.append(target, KIND.PLAN, 'planned', AT).position).toBe(1)
		expect(run_event_stream.append(target, KIND.CHILD_LAUNCH, 'launched #7', AT).position).toBe(2)
		expect(run_event_stream.append(target, KIND.MERGE, '#7 merged', AT).position).toBe(3)
	})

	it('continues the position across a fresh reader of the same target — a session cut', () => {
		const target = fresh_target()

		run_event_stream.append(target, KIND.PLAN, 'planned', AT)
		run_event_stream.append(target, KIND.CUT, 'cut', AT)

		expect(run_event_stream.append(target, KIND.STOP, 'stopped', AT).position).toBe(3)
	})
})

describe('run_event_stream.append — the one enumeration', () => {
	it('refuses a kind the enumeration does not name and appends nothing', () => {
		const target = fresh_target()
		const result = run_event_stream.append(target, 'gossip', 'not a session event', AT)

		expect(result.appended).toBe(false)
		expect(run_event_stream.read_events(target)).toHaveLength(0)
	})

	it('appends every enumerated kind', () => {
		const target = fresh_target()

		for (const kind of run_event_stream.EVENT_KINDS) {
			expect(run_event_stream.append(target, kind, 'x', AT).appended).toBe(true)
		}

		expect(run_event_stream.read_events(target)).toHaveLength(run_event_stream.EVENT_KINDS.length)
	})
})

describe('run_event_stream.read_from — a positioned read', () => {
	it('returns every event after the position, in order, with the next position', () => {
		const target = fresh_target()

		run_event_stream.append(target, KIND.PLAN, 'planned', AT)
		run_event_stream.append(target, KIND.MERGE, '#7 merged', AT)
		run_event_stream.append(target, KIND.PARK, '#8 parked', AT)

		const read = run_event_stream.read_from(target, 1)

		expect(read.events.map((event) => event.text)).toStrictEqual(['#7 merged', '#8 parked'])
		expect(read.next_position).toBe(3)
	})

	it('returns the whole stream from position zero', () => {
		const target = fresh_target()

		run_event_stream.append(target, KIND.PLAN, 'planned', AT)
		run_event_stream.append(target, KIND.STOP, 'stopped', AT)

		expect(run_event_stream.read_from(target, 0).events).toHaveLength(2)
	})

	it('returns an empty read and position zero for an absent stream', () => {
		expect(run_event_stream.read_from(fresh_target(), 0)).toStrictEqual({
			events: [],
			next_position: 0,
		})
	})
})

describe('run_event_stream.read_last — the degenerate read', () => {
	it('returns the newest event', () => {
		const target = fresh_target()

		run_event_stream.append(target, KIND.PLAN, 'planned', AT)
		run_event_stream.append(target, KIND.MERGE, '#7 merged', AT)

		expect(run_event_stream.read_last(target)?.text).toBe('#7 merged')
	})

	it('returns undefined for an empty stream', () => {
		expect(run_event_stream.read_last(fresh_target())).toBeUndefined()
	})
})

describe('run_event_stream.format_event — the line a reader relays', () => {
	it('joins the instant, the kind and the text into one legible line', () => {
		const line = run_event_stream.format_event({
			pos: 4,
			at: AT,
			kind: KIND.MERGE,
			text: '#7 merged',
		})

		expect(line).toContain(AT)
		expect(line).toContain(KIND.MERGE)
		expect(line).toContain('#7 merged')
	})
})

describe('run_event_stream.append — the bound', () => {
	it('keeps at most EVENT_CAP events and drops the oldest', () => {
		const target = fresh_target()
		const overflow = run_event_stream.EVENT_CAP + 1

		for (let index = 0; index < overflow; index += 1) {
			run_event_stream.append(target, KIND.MERGE, `#${String(index)} merged`, AT)
		}

		const events = run_event_stream.read_events(target)

		expect(events).toHaveLength(run_event_stream.EVENT_CAP)
		expect(events[0]?.text).toBe('#1 merged')
		expect(events[0]?.pos).toBe(2)
	})

	it('keeps positions monotonic after the oldest have rolled off', () => {
		const target = fresh_target()
		const overflow = run_event_stream.EVENT_CAP + 5

		for (let index = 0; index < overflow; index += 1) {
			run_event_stream.append(target, KIND.MERGE, 'merged', AT)
		}

		expect(run_event_stream.read_last(target)?.pos).toBe(overflow)
	})
})

describe('run_event_stream.read_events — a malformed line', () => {
	it('skips an unparsable line rather than failing the whole stream', () => {
		const target = fresh_target()
		const good = JSON.stringify({ pos: 9, at: AT, kind: 'merge', text: 'ok' })

		run_event_stream.append(target, KIND.PLAN, 'planned', AT)
		writeFileSync(target, `not json\n${good}\n`)

		const events = run_event_stream.read_events(target)

		expect(events).toHaveLength(1)
		expect(events[0]?.text).toBe('ok')
	})
})
