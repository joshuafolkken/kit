import { EventEmitter } from 'node:events'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_sound_latency } from './run-board-sound-latency'
import {
	run_board_sound_resident,
	type Resident,
	type ResidentChild,
	type ResidentPorts,
} from './run-board-sound-resident'
import { run_board_sound_wav } from './run-board-sound-wav'

const WAV = '/sounds/a chime.wav'
const LENGTH_MS = 250
const RATE = 8000
const SAMPLES = 4000
const HALF_SECOND_MS = 500
const REPORTED_MS = 40
const LATENCY_LINE = 'latency 0.04\n'
const create_directory = temporary_directory()

afterEach(() => {
	run_board_sound_latency.report(undefined)
})

// eslint-disable-next-line unicorn/prefer-event-target -- stands in for a spawned child, a Node EventEmitter
class FakeChild extends EventEmitter implements ResidentChild {
	readonly stdin = new PassThrough()
	readonly stdout = new PassThrough()
	readonly unref = vi.fn()
}

interface Harness {
	child: FakeChild
	resident: Resident
	written: () => Array<string>
	timers: Array<{ ms: number; fire: () => void }>
	spawner: ReturnType<typeof vi.fn>
}

function harness(length_ms: (file: string) => number = () => LENGTH_MS): Harness {
	const child = new FakeChild()
	const chunks: Array<string> = []
	const timers: Array<{ ms: number; fire: () => void }> = []
	const spawner = vi.fn(() => child)
	const ports: ResidentPorts = {
		spawner,
		length_ms,
		after: (ms, fire) => {
			timers.push({ ms, fire })
		},
	}

	child.stdin.on('data', (chunk: Buffer) => {
		chunks.push(chunk.toString())
	})
	const resident = run_board_sound_resident.open(ports)

	if (resident === undefined) throw new Error('the fake resident player did not open')

	return {
		child,
		resident,
		timers,
		spawner,
		written: () => chunks.join('').split('\n').filter(Boolean),
	}
}

async function settled(): Promise<void> {
	await new Promise((resolve) => {
		setImmediate(resolve)
	})
}

describe('run_board_sound_resident.open', () => {
	it('spawns one detached JXA player with piped stdin and stdout, unreferenced', () => {
		const { child, spawner } = harness()

		expect(spawner).toHaveBeenCalledWith(
			'osascript',
			['-l', 'JavaScript', '-e', run_board_sound_resident.SCRIPT],
			{ detached: true, stdio: ['pipe', 'pipe', 'ignore'] },
		)
		expect(child.unref).toHaveBeenCalledOnce()
	})

	it('keeps the latency its first line reports', async () => {
		const { child } = harness()

		child.stdout.write('latency 0.04\nlatency 9\n')
		await settled()

		expect(run_board_sound_latency.delay_ms({})).toBe(REPORTED_MS)
	})

	it('opens none where the player cannot spawn', () => {
		const spawner = vi.fn((): ResidentChild => {
			throw new Error('ENOENT')
		})
		const ports: ResidentPorts = { spawner, length_ms: () => LENGTH_MS, after: vi.fn() }

		expect(run_board_sound_resident.open(ports)).toBeUndefined()
	})
})

// The listener told as `resident`'s output opens.
function awaiting(resident: Resident): ReturnType<typeof vi.fn> {
	const opened = vi.fn()

	async function wait(): Promise<void> {
		await resident.opening
		opened()
	}

	void wait()

	return opened
}

// A real start asks for the opening's first sounds before the player has opened the output: `opening`
// is what the board's first frame waits on.
describe('run_board_sound_resident.open — opening', () => {
	it('holds `opening` until the player’s first line, none to await after', async () => {
		const { child, resident } = harness()
		const opened = awaiting(resident)

		await settled()
		expect(opened).not.toHaveBeenCalled()
		child.stdout.write(LATENCY_LINE)
		await settled()

		expect(opened).toHaveBeenCalledOnce()
		expect(resident.opening).toBeUndefined()
	})

	it.each(['exit', 'error'] as const)(
		'ends the wait as the player is gone on %s',
		async (event) => {
			const { child, resident } = harness()
			const opened = awaiting(resident)

			child.emit(event)
			await settled()

			expect(opened).toHaveBeenCalledOnce()
			expect(resident.opening).toBeUndefined()
		},
	)

	it('ends the wait as the board closes the player', async () => {
		const { resident } = harness()
		const opened = awaiting(resident)

		run_board_sound_resident.close(resident)
		await settled()

		expect(opened).toHaveBeenCalledOnce()
		expect(resident.opening).toBeUndefined()
	})
})

describe('run_board_sound_resident.play', () => {
	it('sends a play line per sound with its own id and loop flag', async () => {
		const { resident, written } = harness()

		run_board_sound_resident.play(resident, WAV, false)
		run_board_sound_resident.play(resident, WAV, true)
		await settled()

		expect(written()).toEqual([`play 0 0 ${WAV}`, `play 1 1 ${WAV}`])
	})

	it('ends a one-shot once it has played through, telling its listeners once', async () => {
		const { resident, timers, written } = harness()
		const exit = vi.fn()
		const playing = run_board_sound_resident.play(resident, WAV, false)

		playing?.on('exit', exit)
		expect(timers.map(({ ms }) => ms)).toEqual([LENGTH_MS])
		timers[0]?.fire()
		playing?.kill()
		await settled()

		expect(exit).toHaveBeenCalledOnce()
		expect(written()).toEqual([`play 0 0 ${WAV}`, 'stop 0'])
	})
})

describe('run_board_sound_resident.play — loops and unreadable files', () => {
	it('sets no timer for a loop, which plays until killed', async () => {
		const { resident, timers, written } = harness()
		const exit = vi.fn()
		const playing = run_board_sound_resident.play(resident, WAV, true)

		playing?.on('exit', exit)
		playing?.kill()
		await settled()

		expect(timers).toEqual([])
		expect(exit).toHaveBeenCalledOnce()
		expect(written()).toEqual([`play 0 1 ${WAV}`, 'stop 0'])
	})

	it('plays none where the file cannot be read', () => {
		const { resident } = harness(() => {
			throw new Error('ENOENT')
		})

		expect(run_board_sound_resident.play(resident, WAV, false)).toBeUndefined()
	})
})

describe('run_board_sound_resident.close', () => {
	it('ends its stdin and every sound it plays, then plays none', () => {
		const { child, resident } = harness()
		const exit = vi.fn()

		run_board_sound_resident.play(resident, WAV, true)?.on('exit', exit)
		run_board_sound_resident.close(resident)

		expect(child.stdin.writableEnded).toBe(true)
		expect(exit).toHaveBeenCalledOnce()
		expect(run_board_sound_resident.play(resident, WAV, false)).toBeUndefined()
	})

	it('closes as the player exits, forgetting its latency report', async () => {
		const { child, resident } = harness()
		const exit = vi.fn()

		child.stdout.write(LATENCY_LINE)
		await settled()
		run_board_sound_resident.play(resident, WAV, true)?.on('exit', exit)
		child.emit('exit')

		expect(exit).toHaveBeenCalledOnce()
		expect(run_board_sound_latency.delay_ms({})).toBe(0)
		expect(run_board_sound_resident.play(resident, WAV, false)).toBeUndefined()
	})
})

describe('run_board_sound_resident.wav_length_ms', () => {
	it('reads a mono 16-bit WAV length from its size and rate', () => {
		const file = path.join(create_directory('run-board-sound-resident-'), 'half.wav')

		writeFileSync(file, run_board_sound_wav.wav_of(new Int16Array(SAMPLES), RATE))

		expect(run_board_sound_resident.wav_length_ms(file)).toBe(HALF_SECOND_MS)
	})
})
