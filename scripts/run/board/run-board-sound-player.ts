import { spawn, type SpawnOptions } from 'node:child_process'
import type { Writable } from 'node:stream'
import { run_board_sound_cues, type CueName } from './run-board-sound-cues'
import { run_board_sound_stream } from './run-board-sound-stream'
import { run_board_sound_wav } from './run-board-sound-wav'

// **A WAV file plays through the OS's own player, with the terminal bell as the fallback** (#7945).
// The player runs as a detached child that is never awaited, so a board render never stalls on it.
// Each platform lists its candidates in order; a candidate that is missing or fails to start emits
// `error` (ENOENT included) and the next one is tried, so "absent" and "broken" share one path and no
// PATH scan is needed. A platform with no row, or with every candidate failed, rings BEL instead.
// `windowsHide` keeps the detached PowerShell from opening a console window over the board.
const BEL = '\u{7}'
const SPAWN_OPTIONS = { detached: true, stdio: 'ignore', windowsHide: true } as const
const POWERSHELL_OPTIONS = ['-NoProfile', '-Command']
const RAW_CHANNELS = '--channels=1'

interface Player {
	command: string
	args: (file: string) => Array<string>
}

// A started player: `exit` and `kill` let a sound that plays while something lasts be ended
// (joshuafolkken/kit#8250).
interface Playing {
	stdin?: Writable | null
	on: (event: 'error' | 'exit', listener: (code?: number | null) => void) => unknown
	unref: () => unknown
	kill: () => unknown
}

type SoundSpawner = (command: string, args: Array<string>, options: SpawnOptions) => Playing

interface SoundPorts {
	spawner: SoundSpawner
	write: (text: string) => unknown
}

// What a start is told: each candidate as it starts — the one that ends up playing last — and that
// every candidate failed.
interface StartHandlers {
	started: (child: Playing) => void
	failed: () => void
}

// The platform whose players are tried and the ports they spawn and write through; this process's own when omitted.
interface PlayerOptions {
	platform?: NodeJS.Platform
	ports?: SoundPorts
}

function powershell_literal(file: string): string {
	return `'${file.replaceAll("'", "''")}'`
}

function powershell_args(file: string): Array<string> {
	return [
		...POWERSHELL_OPTIONS,
		`(New-Object System.Media.SoundPlayer ${powershell_literal(file)}).PlaySync()`,
	]
}

function file_only(file: string): Array<string> {
	return [file]
}

const PLAYERS: Partial<Record<NodeJS.Platform, Array<Player>>> = {
	darwin: [{ command: 'afplay', args: file_only }],
	win32: [{ command: 'powershell', args: powershell_args }],
	linux: [
		{ command: 'paplay', args: file_only },
		{ command: 'pw-play', args: file_only },
		{ command: 'aplay', args: file_only },
	],
}

const DEFAULT_PORTS: SoundPorts = {
	spawner: spawn,
	write: (text) => process.stdout.write(text),
}

function players_for(platform: NodeJS.Platform): Array<Player> {
	return PLAYERS[platform] ?? []
}

// A spawn that throws as it starts (EMFILE, EAGAIN) is a candidate that failed, as one emitting `error`
// is, so it never ends the board drawing it (joshuafolkken/kit#8381).
function spawned(player: Player, file: string, ports: SoundPorts): Playing | undefined {
	try {
		return ports.spawner(player.command, player.args(file), SPAWN_OPTIONS)
	} catch {
		return undefined
	}
}

// A started candidate: one that fails to start goes on to `next`.
function begin(child: Playing, next: () => void, handlers: StartHandlers): void {
	child.on('error', next)
	handlers.started(child)
	child.unref()
}

function start_first(
	file: string,
	players: Array<Player>,
	launch: { ports: SoundPorts; handlers: StartHandlers },
): void {
	const [player, ...rest] = players

	if (player === undefined) {
		launch.handlers.failed()

		return
	}

	function next(): void {
		start_first(file, rest, launch)
	}

	const child = spawned(player, file, launch.ports)

	if (child === undefined) next()
	else begin(child, next, launch.handlers)
}

// The file started on the platform's first working candidate, each start and the failure of every
// candidate told to `handlers`; nothing is written, so a caller chooses its own fallback.
function start(
	file: string,
	handlers: StartHandlers,
	{ platform = process.platform, ports = DEFAULT_PORTS }: PlayerOptions = {},
): void {
	start_first(file, players_for(platform), { ports, handlers })
}

function mac_loop_args(file: string): Array<string> {
	const script = [
		'ObjC.import("AVFoundation");',
		'function run(argv) {',
		'const player = $.AVAudioPlayer.alloc.initWithContentsOfURLError($.NSURL.fileURLWithPath(argv[0]), null);',
		'player.numberOfLoops = -1;',
		'if (!player.play) throw new Error("Audio playback failed");',
		'$.NSRunLoop.currentRunLoop.run;',
		'}',
	].join('\n')

	return ['-l', 'JavaScript', '-e', script, file]
}

function windows_loop_args(file: string): Array<string> {
	return [
		...POWERSHELL_OPTIONS,
		`$player = New-Object System.Media.SoundPlayer ${powershell_literal(file)}; $player.Load(); $player.PlayLooping(); Wait-Event`,
	]
}

// A raw-PCM player is told the file's own rate, since the WAV header it would read is stripped
// (joshuafolkken/kit#8365: the matrix click is 48 kHz, the cues 44.1 kHz).
function raw_rate(file: string): string {
	return String(run_board_sound_wav.rate_of(file))
}

const LOOP_PLAYERS: Partial<Record<NodeJS.Platform, Array<Player>>> = {
	darwin: [{ command: 'osascript', args: mac_loop_args }],
	win32: [{ command: 'powershell', args: windows_loop_args }],
	linux: [
		{
			command: 'paplay',
			args: (file) => ['--raw', '--format=s16le', `--rate=${raw_rate(file)}`, RAW_CHANNELS],
		},
		{
			command: 'pw-play',
			args: (file) => ['--raw', '--format=s16', `--rate=${raw_rate(file)}`, RAW_CHANNELS, '-'],
		},
		{
			command: 'aplay',
			args: (file) => ['-t', 'raw', '-f', 'S16_LE', '-r', raw_rate(file), '-c', '1'],
		},
	],
}

function loop_players(platform: NodeJS.Platform): Array<Player> {
	return LOOP_PLAYERS[platform] ?? []
}

// A Linux loop streams the file's samples to its raw-PCM player; other platforms' players read the file.
function loop_ports(file: string, platform: NodeJS.Platform, ports: SoundPorts): SoundPorts {
	return platform === 'linux' ? run_board_sound_stream.ports_for(file, ports) : ports
}

// Loop inside one audio stream, without closing the output between WAV boundaries.
function loop(
	file: string,
	handlers: StartHandlers,
	{ platform = process.platform, ports = DEFAULT_PORTS }: PlayerOptions = {},
): void {
	try {
		const output = loop_ports(file, platform, ports)

		start_first(file, loop_players(platform), { ports: output, handlers })
	} catch {
		handlers.failed()
	}
}

function play(
	file: string,
	{ platform = process.platform, ports = DEFAULT_PORTS }: PlayerOptions = {},
): void {
	const handlers: StartHandlers = {
		started: () => {
			// a one-shot sound is let go, never ended
		},
		failed: () => ports.write(BEL),
	}

	start(file, handlers, { platform, ports })
}

// A cue's WAV, synthesized once into the cache (`run-board-sound-wav.ts`), then played; a cue whose
// file could not be written rings BEL, as a missing player does.
function play_cue(
	name: CueName,
	platform: NodeJS.Platform = process.platform,
	ports: SoundPorts = DEFAULT_PORTS,
	directory?: string,
): void {
	const file = run_board_sound_wav.cached_wav(
		name,
		run_board_sound_cues.CUES[name].notes,
		directory,
	)

	if (file === undefined) ports.write(BEL)
	else play(file, { platform, ports })
}

const run_board_sound_player = {
	BEL,
	players_for,
	play,
	play_cue,
	loop,
	start,
}

export type { Player, PlayerOptions, Playing, SoundPorts, SoundSpawner, StartHandlers }
export { run_board_sound_player }
