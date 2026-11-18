import { spawn } from 'node:child_process'
import type { Spawner } from '#scripts/run/wake/run-wake-caffeinate'
import { run_board_sound_cues, type CueName } from './run-board-sound-cues'
import { run_board_sound_wav } from './run-board-sound-wav'

// **A WAV file plays through the OS's own player, with the terminal bell as the fallback** (#7945).
// The player runs as a detached child that is never awaited, so a board render never stalls on it.
// Each platform lists its candidates in order; a candidate that is missing or fails to start emits
// `error` (ENOENT included) and the next one is tried, so "absent" and "broken" share one path and no
// PATH scan is needed. A platform with no row, or with every candidate failed, rings BEL instead.
// `windowsHide` keeps the detached PowerShell from opening a console window over the board.
const BEL = '\u{7}'
const SPAWN_OPTIONS = { detached: true, stdio: 'ignore', windowsHide: true } as const

interface Player {
	command: string
	args: (file: string) => Array<string>
}

interface SoundPorts {
	spawner: Spawner
	write: (text: string) => unknown
}

function powershell_literal(file: string): string {
	return `'${file.replaceAll("'", "''")}'`
}

function powershell_args(file: string): Array<string> {
	return [
		'-NoProfile',
		'-Command',
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

function start_first(file: string, players: Array<Player>, ports: SoundPorts): void {
	const [player, ...rest] = players

	if (player === undefined) {
		ports.write(BEL)

		return
	}

	const child = ports.spawner(player.command, player.args(file), SPAWN_OPTIONS)

	child.on('error', () => {
		start_first(file, rest, ports)
	})
	child.unref()
}

function play(
	file: string,
	platform: NodeJS.Platform = process.platform,
	ports: SoundPorts = DEFAULT_PORTS,
): void {
	start_first(file, players_for(platform), ports)
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
	else play(file, platform, ports)
}

const run_board_sound_player = {
	BEL,
	players_for,
	play,
	play_cue,
}

export type { Player, SoundPorts }
export { run_board_sound_player }
