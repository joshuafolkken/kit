import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { reuse_world, type World } from '#scripts/gate/reuse-world-fixture'

// joshuafolkken/kit#4494: the reuse world written to a real project, so the ESLint cache guard reads
// it through its own import graph and the daemon through its own toolchain fingerprint. The merge base
// the project sits on is what `git rev-parse HEAD` answers for it (joshuafolkken/kit#4496).

interface Disk {
	root: string
	written: Map<string, string>
	base: number
}

function create_disk(): Disk {
	return { root: mkdtempSync(path.join(tmpdir(), 'reuse-disk-')), written: new Map(), base: 0 }
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
	disk.written.set(relative, content)
}

// Writes what changed in the world since the last sync, and moves to the merge base it sits on.
function sync(disk: Disk, world: World): void {
	const changed = reuse_world
		.all_paths(disk.written, world.contents)
		.filter((relative) => disk.written.get(relative) !== world.contents.get(relative))

	for (const relative of changed) put(disk, relative, world.contents.get(relative))
	disk.base = world.upstream.length
}

function dispose(disk: Disk): void {
	rmSync(disk.root, { force: true, recursive: true })
}

const reuse_disk = { create_disk, dispose, sync }

export type { Disk }
export { reuse_disk }
