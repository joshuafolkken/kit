import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { Writable } from 'node:stream'
import { setImmediate } from 'node:timers/promises'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { run_board_sound_player, type Playing, type SoundPorts } from './run-board-sound-player'
import { run_board_sound_stream } from './run-board-sound-stream'
import { run_board_sound_wav } from './run-board-sound-wav'

const create_directory = temporary_directory()
const PCM = Buffer.from([1, 0, 2, 0])
const CYCLES = 3
const PIPE_OPTIONS = { detached: true, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true }

function audio_file(pcm = PCM): string {
	const file = path.join(create_directory('sound-stream-'), 'loop.wav')

	const { HEADER_BYTES, SAMPLE_RATE, wav_of } = run_board_sound_wav
	const header = wav_of(new Int16Array(0), SAMPLE_RATE).subarray(0, HEADER_BYTES)

	writeFileSync(file, Buffer.concat([header, pcm]))

	return file
}

function recording_input(chunks: Array<Buffer>): Writable {
	return Writable.fromWeb(
		new WritableStream({
			async write(chunk: Uint8Array): Promise<void> {
				chunks.push(Buffer.from(chunk))

				if (chunks.length >= CYCLES) {
					await new Promise<void>(() => {
						// Hold the write so the pipe must stop producing more PCM.
					})
				}
			},
		}),
		{ highWaterMark: PCM.length },
	)
}

function harness(): {
	child: Playing
	events: EventTarget
	input: Writable
	chunks: Array<Buffer>
	ports: SoundPorts
	unpipe: Mock
} {
	const events = new EventTarget()
	const chunks: Array<Buffer> = []
	const input = recording_input(chunks)
	const unpipe = vi.fn()

	input.on('unpipe', unpipe)
	const child: Playing = {
		stdin: input,
		on: (event, listener) => events.addEventListener(event, () => listener()),
		kill: vi.fn(),
		unref: vi.fn(),
	}
	const ports: SoundPorts = { spawner: vi.fn(() => child), write: vi.fn() }

	return { child, events, input, chunks, ports, unpipe }
}

function launch(test: ReturnType<typeof harness>): Playing {
	return run_board_sound_stream.ports_for(audio_file(), test.ports).spawner('paplay', [], {
		detached: true,
		windowsHide: true,
	})
}

describe('run_board_sound_stream', () => {
	it('sends repeated PCM through one child with bounded buffering (ac-036747cc)', async () => {
		const test = harness()
		const playing = launch(test)

		await setImmediate()
		await setImmediate()
		expect(test.chunks).toStrictEqual(Array.from({ length: CYCLES }, () => PCM))
		expect(test.ports.spawner).toHaveBeenCalledExactlyOnceWith('paplay', [], PIPE_OPTIONS)
		playing.kill()
		await setImmediate()
		expect(test.unpipe).toHaveBeenCalledOnce()
		expect(test.child.kill).toHaveBeenCalledOnce()
	})
})

describe('run_board_sound_stream cleanup', () => {
	it.each(['error', 'exit'] as const)(
		'releases the source when the child emits %s',
		async (event) => {
			const test = harness()
			const unpipe = vi.fn()

			test.input.on('unpipe', unpipe)
			launch(test)
			await setImmediate()

			test.events.dispatchEvent(new Event(event))
			await setImmediate()

			expect(unpipe).toHaveBeenCalledOnce()
		},
	)

	it('kills and releases a child whose input fails', async () => {
		const test = harness()
		const unpipe = vi.fn()

		test.input.on('unpipe', unpipe)
		launch(test)
		await setImmediate()

		test.input.emit('error', new Error('broken pipe'))
		await setImmediate()

		expect(unpipe).toHaveBeenCalledOnce()
		expect(test.child.kill).toHaveBeenCalledOnce()
	})

	it('rejects empty PCM before spawning a child', () => {
		const test = harness()

		expect(() =>
			run_board_sound_stream.ports_for(audio_file(Buffer.alloc(0)), test.ports),
		).toThrow()
		expect(test.ports.spawner).not.toHaveBeenCalled()
	})
})

describe('run_board_sound_stream fallback', () => {
	it('kills a child that has no audio input', () => {
		const test = harness()

		delete test.child.stdin
		expect(() => launch(test)).toThrow('Missing audio input')
		expect(test.child.kill).toHaveBeenCalledOnce()
	})

	it('disposes the failed stream and pipes the next candidate', async () => {
		const first = harness()
		const second = harness()
		const spawner = vi.fn().mockReturnValueOnce(first.child).mockReturnValueOnce(second.child)
		const started = vi.fn()

		run_board_sound_player.loop(audio_file(), { started, failed: vi.fn() }, 'linux', {
			...first.ports,
			spawner,
		})
		first.events.dispatchEvent(new Event('error'))
		await setImmediate()

		expect(spawner).toHaveBeenLastCalledWith(
			'pw-play',
			['--raw', '--format=s16', '--rate=44100', '--channels=1', '-'],
			PIPE_OPTIONS,
		)
		expect(first.unpipe).toHaveBeenCalledOnce()
		started.mock.calls.at(-1)?.[0].kill()
	})
})
