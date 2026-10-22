import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { reuse_world, type World } from '#scripts/gate/reuse-world-fixture'

// joshuafolkken/kit#4494: the reuse world written to a real project, so the ESLint cache guard reads
// it through its own import graph and the daemon through its own file times. Each step is one tick of
// a clock every write stamps as its time, so "newer than the daemon" never rests on the file
// system's timestamp resolution.

interface Disk {
	root: string
	written: Map<string, string>
	tick: number
	base: number
}

const EPOCH_SECONDS = 1_700_000_000
const MS_PER_SECOND = 1000
// What `git rev-parse --git-path logs/HEAD` answers; git appends to it on every merge.
const HEAD_REFLOG = path.join('.git-directory', 'logs', 'HEAD')

function seconds_at(tick: number): number {
	return EPOCH_SECONDS + tick
}

function ms_at(tick: number): number {
	return seconds_at(tick) * MS_PER_SECOND
}

function stamp(disk: Disk, relative: string): void {
	const time = seconds_at(disk.tick)

	utimesSync(path.join(disk.root, relative), time, time)
}

function create_disk(): Disk {
	const root = mkdtempSync(path.join(tmpdir(), 'reuse-disk-'))

	mkdirSync(path.dirname(path.join(root, HEAD_REFLOG)), { recursive: true })
	writeFileSync(path.join(root, HEAD_REFLOG), '')
	const disk: Disk = { root, written: new Map(), tick: 0, base: 0 }

	stamp(disk, HEAD_REFLOG)

	return disk
}

function put(disk: Disk, relative: string, content: string | undefined): void {
	const file = path.join(disk.root, relative)

	if (content === undefined) {
		rmSync(file, { force: true })
		disk.written.delete(relative)

		return
	}

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, content)
	stamp(disk, relative)
	disk.written.set(relative, content)
}

function merge(disk: Disk, world: World): void {
	if (world.upstream.length === disk.base) return
	appendFileSync(path.join(disk.root, HEAD_REFLOG), `merge ${String(world.upstream.length)}\n`)
	stamp(disk, HEAD_REFLOG)
	disk.base = world.upstream.length
}

// Writes what changed in the world since the last sync, at the next tick.
function sync(disk: Disk, world: World): void {
	disk.tick += 1
	const changed = reuse_world
		.all_paths(disk.written, world.contents)
		.filter((relative) => disk.written.get(relative) !== world.contents.get(relative))

	for (const relative of changed) put(disk, relative, world.contents.get(relative))
	merge(disk, world)
}

function dispose(disk: Disk): void {
	rmSync(disk.root, { force: true, recursive: true })
}

const reuse_disk = { create_disk, dispose, HEAD_REFLOG, ms_at, sync }

export type { Disk }
export { reuse_disk }
