import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import type { Playing, SoundPorts } from './run-board-sound-player'
import { run_board_sound_wav } from './run-board-sound-wav'

function* repetitions(pcm: Buffer): Generator<Buffer> {
	while (pcm.length > 0) yield pcm
}

function input_of(child: Playing): NonNullable<Playing['stdin']> {
	const input = child.stdin

	if (input === undefined || input === null) {
		child.kill()
		throw new Error('Missing audio input')
	}

	return input
}

function feed(child: Playing, pcm: Buffer): Playing {
	const input = input_of(child)
	const source = Readable.from(repetitions(pcm))

	function dispose(): void {
		source.unpipe(input)
		source.destroy()
	}

	input.on('error', () => {
		dispose()
		child.kill()
	})
	child.on('error', dispose)
	child.on('exit', dispose)
	source.pipe(input)

	return {
		on: child.on.bind(child),
		unref: child.unref.bind(child),
		kill: () => {
			dispose()

			return child.kill()
		},
	}
}

// Pipe backpressure keeps the next clip buffered without reopening the audio output.
function ports_for(file: string, ports: SoundPorts): SoundPorts {
	const pcm = readFileSync(file).subarray(run_board_sound_wav.HEADER_BYTES)
	if (pcm.length === 0) throw new Error('Empty audio input')

	return {
		write: ports.write,
		spawner: (command, args, options) => {
			const child = ports.spawner(command, args, {
				...options,
				stdio: ['pipe', 'ignore', 'ignore'],
			})

			return feed(child, pcm)
		},
	}
}

const run_board_sound_stream = { ports_for }

export { run_board_sound_stream }
