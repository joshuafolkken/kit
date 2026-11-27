import { describe, expect, it } from 'vitest'
import { run_board_theme_events } from './run-board-theme-events'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_frame } from './run-board-theme-host-frame'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { ThemeModule, ThemeTimeline, TimelineMessage } from './run-board-theme-host-types'
import { run_board_theme_registry } from './run-board-theme-registry'
import { run_board_theme_run, type ThemeValue } from './run-board-theme-run'

// joshuafolkken/kit#8969: each theme says whether the frame it draws still plays an event — the
// condition its own draw reads — so demo mode's footer goes back to IDLE on the frame the effect ends,
// however long the event's message is.

const { HOST } = run_board_theme_host_fixture
const THEMES = run_board_theme_run.THEME_VALUES.filter((value) => value !== '')
const EVENTS = ['n', 'p', 'r'] as const
const TYPED = ['p', 'r'] as const
// Past the longest effect a demo event plays, in ticks; the ticks after its end checked still over.
const LIMIT = 2000
const AFTER = 40
const HALF = 2
// A dense theme draws hundreds of frames per event; a loaded CI runner needs more than the default.
const HEAVY_TIMEOUT_MS = 60_000

type PlayedEvent = (typeof EVENTS)[number]

function module_of(value: ThemeValue): ThemeModule {
	const factory = run_board_theme_registry.factory_of(value)

	if (factory === undefined) throw new Error(`no theme ${value}`)

	return factory(HOST.api)
}

function playing_at(module: ThemeModule, timeline: ThemeTimeline, tick: number): boolean {
	run_board_theme_host_frame.frame_of(module, HOST.api, timeline, tick)

	return module.playing?.(run_board_theme_host_state.state_of(HOST.layout, timeline, tick)) ?? true
}

interface Ended {
	end: number
	is_over_after: boolean
}

// One pass, drawn from the first tick on one module: the first tick `module` says no play, and whether
// it still says so over the AFTER ticks from there.
function ended(module: ThemeModule, timeline: ThemeTimeline): Ended {
	let end = 0

	while (end < LIMIT && playing_at(module, timeline, end)) end += 1

	const after = Array.from({ length: AFTER }, (_, offset) =>
		playing_at(module, timeline, end + offset),
	)

	return { end, is_over_after: !after.includes(true) }
}

// The first tick a fresh `value` draws `timeline` and says it no longer plays; LIMIT where it never does.
function end_of(value: ThemeValue, timeline: ThemeTimeline): number {
	return ended(module_of(value), timeline).end
}

function demo(key: PlayedEvent): ThemeTimeline {
	return run_board_theme_events.demo_timeline(key, HOST.layout.row_text, 0)
}

function halved(messages: ReadonlyArray<TimelineMessage>): Array<TimelineMessage> {
	return messages.map((message) => ({
		...message,
		text: message.text.slice(0, Math.ceil(message.text.length / HALF)),
	}))
}

// The demo's `key` event with every message half as long.
function shorter(key: PlayedEvent): ThemeTimeline {
	const { notice, progress, row } = demo(key)

	return { notice: halved(notice), progress: halved(progress), row: halved(row) }
}

describe.each(THEMES)('%s ThemeModule.playing', (value) => {
	it('says no play on an idle timeline', () => {
		expect(end_of(value, run_board_theme_run.IDLE)).toBe(0)
	})

	it.each(EVENTS)(
		'plays the demo’s %s event, then says it is over and stays over',
		(key) => {
			const { end, is_over_after } = ended(module_of(value), demo(key))

			expect(end).toBeGreaterThan(0)
			expect(end).toBeLessThan(LIMIT)
			expect(is_over_after).toBe(true)
		},
		HEAVY_TIMEOUT_MS,
	)

	// A NOTICE plays for the same time whatever its text; the typed events follow their text.
	it.each(TYPED)('plays a shorter %s message shorter', (key) => {
		expect(end_of(value, shorter(key))).toBeLessThan(end_of(value, demo(key)))
	})
})
