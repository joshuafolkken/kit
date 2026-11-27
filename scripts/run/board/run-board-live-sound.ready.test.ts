import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KeyReading } from './run-board-keys'
import { run_board_live_sound, type Shown } from './run-board-live-sound'
import { run_board_sound_player } from './run-board-sound-player'
import type { ResidentChild } from './run-board-sound-resident'
import type { TypingSound } from './run-board-sound-typing'

// A real start asks for the opening's first sounds before the resident player has opened the output, so
// the typing trill of the opening's first lines was never heard: the board's first frame waits for the
// player, no longer than `READY_WAIT_MS`, and not at all where no sound would be lost. No sound plays:
// the resident player is a fake child, never the Mac's own.

const { READY_WAIT_MS, ready } = run_board_live_sound
const TRILL: TypingSound = { set: () => undefined, stop: () => undefined }
const SOUND_ON: KeyReading = { folded: undefined, sound: () => true }
const SOUND_OFF: KeyReading = { folded: undefined, sound: () => false }
const LATENCY_LINE = 'latency 0.04\n'

// eslint-disable-next-line unicorn/prefer-event-target -- stands in for a spawned child, a Node EventEmitter
class FakeChild extends EventEmitter implements ResidentChild {
	readonly stdin = new PassThrough()
	readonly stdout = new PassThrough()
	readonly unref = vi.fn()
}

// The resident player opened on a fake child, its output not yet open.
function prepared(): FakeChild {
	const child = new FakeChild()

	run_board_sound_player.prepare({
		platform: 'darwin',
		ports: { spawner: () => child, length_ms: () => 0, after: () => undefined },
	})

	return child
}

interface Clock {
	sleep: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>
	wake: () => void
}

// A sleep that ends only when the test wakes it.
function clock_of(): Clock {
	const sleeping: Array<() => void> = []
	const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {
		await new Promise<void>((resolve) => {
			sleeping.push(resolve)
		})
	})

	return {
		sleep,
		wake: () => {
			for (const wake of sleeping) wake()
		},
	}
}

interface Waiting {
	typing_sound?: TypingSound | undefined
	keys?: KeyReading
	shown?: Shown | undefined
}

// The listener told as the board is ready to draw its first frame.
function begun(clock: Clock, waiting: Waiting = {}): ReturnType<typeof vi.fn> {
	const done = vi.fn()
	const board = {
		sleep: clock.sleep,
		typing_sound: 'typing_sound' in waiting ? waiting.typing_sound : TRILL,
	}
	const shown = 'shown' in waiting ? waiting.shown : (): 'wopr' => 'wopr'

	async function wait(): Promise<void> {
		await ready(board, waiting.keys ?? SOUND_ON, shown)
		done()
	}

	void wait()

	return done
}

async function settled(): Promise<void> {
	await new Promise((resolve) => {
		setImmediate(resolve)
	})
}

afterEach(() => {
	run_board_sound_player.close()
})

describe('run_board_live_sound.ready', () => {
	it('waits until the resident player opens the output, not before', async () => {
		const child = prepared()
		const clock = clock_of()
		const done = begun(clock)

		await settled()
		expect(done).not.toHaveBeenCalled()
		child.stdout.write(LATENCY_LINE)
		await settled()

		expect(done).toHaveBeenCalledOnce()
		expect(clock.sleep).toHaveBeenCalledWith(READY_WAIT_MS)
	})

	it('waits no longer than the bound for a player that never opens', async () => {
		prepared()
		const clock = clock_of()
		const done = begun(clock)

		await settled()
		expect(done).not.toHaveBeenCalled()
		clock.wake()
		await settled()

		expect(done).toHaveBeenCalledOnce()
	})

	it('waits for nothing once the player is open', async () => {
		const child = prepared()
		const clock = clock_of()

		child.stdout.write(LATENCY_LINE)
		await settled()
		const done = begun(clock)

		await settled()

		expect(done).toHaveBeenCalledOnce()
		expect(clock.sleep).not.toHaveBeenCalled()
	})
})

describe('run_board_live_sound.ready with nothing to wait for', () => {
	it.each<[string, Waiting]>([
		['the sound switch is off', { keys: SOUND_OFF }],
		['no theme is shown', { shown: () => undefined }],
		['the board has no theme run', { shown: undefined }],
		['the board has no trill', { typing_sound: undefined }],
	])('asks the clock for no sleep where %s', async (_name, waiting) => {
		prepared()
		const clock = clock_of()
		const done = begun(clock, waiting)

		await settled()

		expect(done).toHaveBeenCalledOnce()
		expect(clock.sleep).not.toHaveBeenCalled()
	})

	it('asks the clock for no sleep where no resident player was opened', async () => {
		const clock = clock_of()
		const done = begun(clock)

		await settled()

		expect(done).toHaveBeenCalledOnce()
		expect(clock.sleep).not.toHaveBeenCalled()
	})
})
