import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { run_board_faint } from './run-board-faint'
import { run_board_header_notice, type Notice } from './run-board-header-notice'
import { run_board_row_key } from './run-board-row-key'
import type { CueName } from './run-board-sound-cues'

const { key_of, next, part_of } = run_board_header_notice
const HOUR_MS = 3_600_000
const YEAR = 2026
const HOUR = 10
const MINUTE = 42
const AT_MS = new Date(YEAR, 0, 1, HOUR, MINUTE).getTime()
const LATER_MS = AT_MS + 1
const STOPPED_ISSUE = 8103
const STOPPED = 'stopped'
const ALERT: CueName = 'alert'
const OSC = '\u{1B}]8;;'

type Shown = string | undefined

interface Row {
	scene: string
	cue: CueName
	word: string
	issue?: number
	shown: string
}

// Each cue as its icon and name, then the issue and its words, or the run's words alone
// (joshuafolkken/kit#8595).
const ROWS: ReadonlyArray<Row> = [
	{
		scene: 'a launch',
		cue: 'launch',
		word: 'running',
		issue: 8090,
		shown: '🔄 launch · #8090 running',
	},
	{
		scene: 'a lane end',
		cue: 'lane-end',
		word: 'merged',
		issue: 8096,
		shown: '✅ lane-end · #8096 merged',
	},
	{ scene: 'a drain', cue: 'drain', word: 'run drained', shown: '🏁 drain · run drained' },
	{
		scene: 'a wait on a person',
		cue: 'human',
		word: 'needs a person',
		issue: 8026,
		shown: '🙋 human · #8026 needs a person',
	},
	{
		scene: 'a stop',
		cue: ALERT,
		word: STOPPED,
		issue: STOPPED_ISSUE,
		shown: '🛑 alert · #8103 stopped',
	},
	{ scene: 'a usage hold', cue: ALERT, word: 'usage held', shown: '🛑 alert · usage held' },
]
const QUIET = { last_event_ms: undefined, outage: undefined, is_stopped: false }
// A header with nothing standing: no outage, no failed read, no heartbeat read.
const CALM = { now_ms: AT_MS, ended_ms: undefined, activity: QUIET }

function notice_of({ cue, word, issue }: Omit<Row, 'scene' | 'shown'>, is_repeat = false): Notice {
	return { cause: { cue, word, issue }, is_repeat, at_ms: AT_MS }
}

const STOP_NOTICE = notice_of({ cue: ALERT, word: STOPPED, issue: STOPPED_ISSUE })
const STOP_WORDS = '10:42 🛑 alert · #8103 stopped'

function plain_link(reference: string): string {
	return reference
}

function osc_link(reference: string): string {
	return `${OSC}https://example.test/${reference}\u{7}${reference}${OSC}\u{7}`
}

function shown(notice: Notice | undefined, is_sound_on: boolean | undefined = true): Shown {
	return stripVTControlCharacters(part_of({ ...CALM, is_sound_on, notice, link: plain_link }))
}

describe('run_board_header_notice.part_of', () => {
	it.each(ROWS)('draws the minute, the cue and what sounded it for $scene', (entry) => {
		expect(shown(notice_of(entry))).toBe(`🔊 10:42 ${entry.shown}`)
	})

	it('draws — after the speaker before any notice', () => {
		expect(shown(undefined)).toBe('🔊 —')
	})

	it('marks a notice sounded again ten minutes on with ×2', () => {
		const repeat = notice_of({ cue: ALERT, word: STOPPED, issue: STOPPED_ISSUE }, true)

		expect(shown(repeat)).toBe(`🔊 ${STOP_WORDS} ×2`)
	})

	it('draws the notice behind 🔇 while the sound is off', () => {
		expect(shown(STOP_NOTICE, false)).toBe(`🔇 ${STOP_WORDS}`)
	})

	it('links the issue number without changing what it shows', () => {
		const linked = part_of({ ...CALM, is_sound_on: true, notice: STOP_NOTICE, link: osc_link })

		expect(linked).toContain(OSC)
		expect(stripVTControlCharacters(linked)).toBe(shown(STOP_NOTICE))
	})

	it('draws the slot without a switch where the board reads none', () => {
		expect(part_of({ ...CALM, notice: STOP_NOTICE, link: plain_link })).toBe(STOP_WORDS)
	})
})

// joshuafolkken/kit#8475: a settled notice fades, and a standing state takes the slot.
function slot_of(is_settled: boolean): string {
	return part_of({ ...CALM, notice: { ...STOP_NOTICE, is_settled }, link: plain_link })
}

describe('run_board_header_notice.part_of settling', () => {
	it('draws a notice faint once its cause has settled, plain while it holds', () => {
		const faint = vi.spyOn(run_board_faint, 'faint').mockImplementation((text) => `<${text}>`)

		expect(slot_of(true)).toBe(`<${STOP_WORDS}>`)
		expect(slot_of(false)).toBe(STOP_WORDS)
		faint.mockRestore()
	})

	it('draws a standing state in place of the notice', () => {
		const outage = { from_ms: AT_MS - HOUR_MS, down_ms: AT_MS }
		const offline = { ...CALM, activity: { ...QUIET, outage } }
		const slot = part_of({ ...offline, notice: STOP_NOTICE, link: plain_link })

		expect(stripVTControlCharacters(slot)).toMatch(/^📴 /u)
	})
})

// joshuafolkken/kit#8114: where the board types rows, the words carry their key behind the switch.
describe('run_board_header_notice.part_of keyed', () => {
	const keyed = { ...CALM, notice: STOP_NOTICE, link: plain_link, is_keyed: true }
	const words = STOP_WORDS

	it('keys the words behind the switch, the same key whether the sound is on or off', () => {
		const on = run_board_row_key.split_key(part_of({ ...keyed, is_sound_on: true }) ?? '')
		const off = run_board_row_key.split_key(part_of({ ...keyed, is_sound_on: false }) ?? '')

		expect(on).toStrictEqual({
			key: `notice:${words}`,
			text: `🔊 ${words}`,
			prefix: '🔊 ',
			suffix: '',
		})
		expect(off.key).toBe(on.key)
		expect(key_of({ ...keyed, is_sound_on: false })).toBe(on.key)
	})

	it('gives a new key when the notice changes', () => {
		const other = { ...STOP_NOTICE, at_ms: AT_MS + HOUR_MS }

		expect(key_of({ ...keyed, is_sound_on: true, notice: other })).not.toBe(
			key_of({ ...keyed, is_sound_on: true }),
		)
	})

	it('keeps a notice’s key as it settles, so fading it does not type it again', () => {
		const settled = { ...STOP_NOTICE, is_settled: true }

		expect(key_of({ ...keyed, is_sound_on: true, notice: settled })).toBe(
			key_of({ ...keyed, is_sound_on: true }),
		)
	})

	it('keys nothing where the board types no rows', () => {
		const plain = part_of({ ...keyed, is_keyed: undefined, is_sound_on: true })

		expect(run_board_row_key.split_key(plain).key).toBeUndefined()
		expect(key_of({ ...keyed, is_keyed: undefined, is_sound_on: true })).toBeUndefined()
	})
})

describe('run_board_header_notice.next', () => {
	it('takes this frame’s sounding, stamped with the frame’s time', () => {
		const sounding = { cause: STOP_NOTICE.cause, is_repeat: false }

		expect(next(undefined, sounding, LATER_MS)).toStrictEqual({ ...sounding, at_ms: LATER_MS })
	})

	it('keeps the last notice on a frame that sounds nothing', () => {
		expect(next(STOP_NOTICE, undefined, LATER_MS)).toBe(STOP_NOTICE)
	})

	it('settles the notice once its cause is gone from what the frame holds', () => {
		expect(next(STOP_NOTICE, undefined, LATER_MS, [])?.is_settled).toBe(true)
		expect(next(STOP_NOTICE, undefined, LATER_MS, [STOP_NOTICE.cause])?.is_settled).toBe(false)
	})
})
