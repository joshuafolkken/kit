import { spawn, type SpawnOptions } from 'node:child_process'
import { statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_board_sound_latency } from './run-board-sound-latency'
import { run_board_sound_wav } from './run-board-sound-wav'

// **One resident player holds the Mac's output open** (joshuafolkken/kit#9087): a player spawned per
// sound opens the output each time, which a Bluetooth device takes a second or more to do. The resident
// player starts an audio engine — the output stays open while it runs — reports the device's latency on
// its first stdout line, then plays each file a `play <id> <loop> <path>` line names and stops each a
// `stop <id>` line names. It ends at its stdin's EOF: the board's own `close`, or the OS closing the
// board's end however the board dies.

// `UTF8` is Foundation's UTF-8 string encoding.
const SCRIPT = [
	'ObjC.import("AVFoundation");',
	'const UTF8 = 4;',
	'function line(text) {',
	String.raw`$.NSFileHandle.fileHandleWithStandardOutput.writeData($(text + "\n").dataUsingEncoding(UTF8));`,
	'}',
	'function command(players, text) {',
	'const [verb, id, loop, ...path] = text.split(" ");',
	'if (players[id]) { players[id].stop; delete players[id]; }',
	'if (verb !== "play") return;',
	'const url = $.NSURL.fileURLWithPath(path.join(" "));',
	'const player = $.AVAudioPlayer.alloc.initWithContentsOfURLError(url, null);',
	'if (loop === "1") player.numberOfLoops = -1;',
	'player.play;',
	'players[id] = player;',
	'}',
	'function run() {',
	'const engine = $.AVAudioEngine.alloc.init;',
	'engine.mainMixerNode;',
	'engine.startAndReturnError(null);',
	'line("latency " + engine.outputNode.presentationLatency);',
	'const players = {};',
	'const input = $.NSFileHandle.fileHandleWithStandardInput;',
	'let rest = "";',
	'for (;;) {',
	'const data = input.availableData;',
	'if (Number(data.length) === 0) break;',
	'const text = $.NSString.alloc.initWithDataEncoding(data, UTF8).js;',
	String.raw`const lines = (rest + text).split("\n");`,
	'rest = lines.pop();',
	'for (const each of lines) command(players, each);',
	'}',
	'}',
].join('\n')
const SPAWN_OPTIONS: SpawnOptions = { detached: true, stdio: ['pipe', 'pipe', 'ignore'] }
const BYTES_PER_SAMPLE = 2

// The resident player's process: its stdin takes the commands, its stdout gives the latency report.
interface ResidentChild {
	stdin: Writable | null
	stdout: Readable | null
	on: (event: 'error' | 'exit', listener: () => void) => unknown
	unref: () => unknown
}

type ResidentSpawner = (
	command: string,
	args: Array<string>,
	options: SpawnOptions,
) => ResidentChild

// How the resident player is spawned, how long a file plays, and the timer a one-shot ends by.
interface ResidentPorts {
	spawner: ResidentSpawner
	length_ms: (file: string) => number
	after: (ms: number, fire: () => void) => void
}

// A sound the resident player plays, seen as a spawned player is (`run-board-sound-player.ts`).
interface ResidentPlaying {
	on: (event: 'error' | 'exit', listener: (code?: number | null) => void) => unknown
	unref: () => unknown
	kill: () => unknown
}

interface Sound {
	id: number
	exits: Array<(code?: number | null) => void>
	is_over: boolean
}

interface Resident {
	child: ResidentChild
	ports: ResidentPorts
	next_id: number
	sounds: Map<number, Sound>
	is_closed: boolean
	// Settled as the output is open — the player wrote its first line — or as the player is gone; none after.
	opening: Promise<void> | undefined
	opened: (() => void) | undefined
}

// A mono 16-bit WAV's length from its size and its header's rate.
function wav_length_ms(file: string): number {
	const samples = (statSync(file).size - run_board_sound_wav.HEADER_BYTES) / BYTES_PER_SAMPLE

	return (samples / run_board_sound_wav.rate_of(file)) * MS_PER_SECOND
}

const DEFAULT_PORTS: ResidentPorts = {
	spawner: spawn,
	length_ms: wav_length_ms,
	after: (ms, fire) => {
		setTimeout(fire, ms).unref()
	},
}

function send(resident: Resident, text: string): void {
	if (!resident.is_closed) resident.child.stdin?.write(`${text}\n`)
}

// A sound ended — played through, killed, or its player gone — its listeners told once.
function ended(resident: Resident, sound: Sound): void {
	if (sound.is_over) return
	sound.is_over = true
	resident.sounds.delete(sound.id)
	send(resident, `stop ${String(sound.id)}`)
	for (const exit of sound.exits) exit(0)
}

// The wait for the output over: whoever awaits `opening` goes on, and there is none to await after.
function opened(resident: Resident): void {
	resident.opened?.()
	resident.opening = undefined
	resident.opened = undefined
}

// The player gone: no more sounds, every one playing ended, and its latency report forgotten.
function closed(resident: Resident): void {
	if (resident.is_closed) return
	resident.is_closed = true
	opened(resident)
	run_board_sound_latency.report(undefined)
	for (const sound of resident.sounds.values()) ended(resident, sound)
}

function playing_of(resident: Resident, sound: Sound): ResidentPlaying {
	return {
		on: (event, listener) => {
			if (event === 'exit') sound.exits.push(listener)
		},
		unref: () => {
			// a resident sound holds no process of its own
		},
		kill: () => {
			ended(resident, sound)
		},
	}
}

function spawned(ports: ResidentPorts): ResidentChild | undefined {
	try {
		return ports.spawner('osascript', ['-l', 'JavaScript', '-e', SCRIPT], SPAWN_OPTIONS)
	} catch {
		return undefined
	}
}

// The player's first line — written once its engine has started, so the output is open — kept as its
// latency report; a player with no stdout to read is taken as open at once.
function listen(resident: Resident): void {
	const { stdout } = resident.child

	if (stdout === null) {
		opened(resident)

		return
	}

	createInterface({ input: stdout }).once('line', (line) => {
		run_board_sound_latency.report(run_board_sound_latency.reported_of(line))
		opened(resident)
	})
}

// The player watched: gone as it fails or exits, and its first line heard.
function watch(resident: Resident): void {
	const { child } = resident

	function close_it(): void {
		closed(resident)
	}

	child.on('error', close_it)
	child.on('exit', close_it)
	child.stdin?.on('error', close_it)
	listen(resident)
}

// A resident around `child`, its output not yet open.
function resident_of(child: ResidentChild, ports: ResidentPorts): Resident {
	const resident: Resident = {
		child,
		ports,
		next_id: 0,
		sounds: new Map(),
		is_closed: false,
		opening: undefined,
		opened: undefined,
	}

	resident.opening = new Promise<void>((resolve) => {
		resident.opened = resolve
	})

	return resident
}

// The resident player started, its latency report kept as it arrives; none where it cannot spawn.
function open(ports: ResidentPorts = DEFAULT_PORTS): Resident | undefined {
	const child = spawned(ports)

	if (child === undefined) return undefined
	const resident = resident_of(child, ports)

	watch(resident)
	child.unref()

	return resident
}

// How long `file` plays: a loop for ever; none where it cannot be read.
function length_of(resident: Resident, file: string, is_loop: boolean): number | undefined {
	if (is_loop) return Infinity

	try {
		return resident.ports.length_ms(file)
	} catch {
		return undefined
	}
}

// `file` played on the resident player — looping until killed, else ending once it has played through;
// none once the player is gone or the file cannot be read, so the caller tries its next player.
function play(resident: Resident, file: string, is_loop: boolean): ResidentPlaying | undefined {
	const length_ms = resident.is_closed ? undefined : length_of(resident, file, is_loop)

	if (length_ms === undefined) return undefined
	const sound: Sound = { id: resident.next_id, exits: [], is_over: false }

	resident.next_id += 1
	resident.sounds.set(sound.id, sound)
	send(resident, `play ${String(sound.id)} ${String(Number(is_loop))} ${file}`)

	if (Number.isFinite(length_ms)) {
		resident.ports.after(length_ms, () => {
			ended(resident, sound)
		})
	}

	return playing_of(resident, sound)
}

// The resident player ended: its stdin closed, and every sound it plays ended.
function close(resident: Resident): void {
	resident.child.stdin?.end()
	closed(resident)
}

// `DEFAULT_PORTS` is exported for the unit suite's sound guard alone (`tools/test/test-sound-guard.ts`).
const run_board_sound_resident = { DEFAULT_PORTS, SCRIPT, close, open, play, wav_length_ms }

export { run_board_sound_resident }
export type { Resident, ResidentChild, ResidentPlaying, ResidentPorts, ResidentSpawner }
