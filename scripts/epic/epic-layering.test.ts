import { readdirSync } from 'node:fs'
import path from 'node:path'
import { import_graph, type FileGraph } from '#scripts/refactor/import-graph'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2904: the epic code used to live in two directories that imported each other —
// `scripts/epic/` read `scripts/git/git-epic-*`, and six of those read `scripts/epic/` back, with the
// GitHub I/O layer itself reading an epic type. The direction is now one-way: the epic domain builds
// on the git layer, and no git module the epic domain depends on may depend on the epic domain in
// turn. A git module that consumes both from above (the followup that closes a finished epic) stays
// allowed, because no epic module reaches it.

const ROOT = process.cwd()
const SCRIPTS = path.join(ROOT, 'scripts')
const EPIC_DIR = `${path.join(SCRIPTS, 'epic')}${path.sep}`
const GIT_DIR = `${path.join(SCRIPTS, 'git')}${path.sep}`
const TEST_SUFFIX = '.test.ts'
const SOURCE_SUFFIX = '.ts'
// A module the epic domain must reach, so an empty walk cannot pass the rule vacuously.
const GH_COMMAND = path.join(SCRIPTS, 'git', 'git-gh-command.ts')

function runtime_sources(): ReadonlyArray<string> {
	const entries = readdirSync(SCRIPTS, { recursive: true, encoding: 'utf8' })

	return entries
		.filter((entry) => entry.endsWith(SOURCE_SUFFIX) && !entry.endsWith(TEST_SUFFIX))
		.map((entry) => path.join(SCRIPTS, entry))
}

function is_epic(file: string): boolean {
	return file.startsWith(EPIC_DIR)
}

function reachable_from(seeds: ReadonlyArray<string>, forward: FileGraph): ReadonlySet<string> {
	const seen = new Set<string>(seeds)
	const pending = [...seeds]

	for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
		const fresh = [...(forward.get(file) ?? [])].filter((target) => !seen.has(target))

		for (const target of fresh) seen.add(target)
		pending.push(...fresh)
	}

	return seen
}

// Every git module the epic domain reaches that imports it back.
function back_edges(forward: FileGraph): ReadonlyArray<string> {
	const epic_files = [...forward.keys()].filter((file) => is_epic(file))
	const reached = reachable_from(epic_files, forward)
	const git_files = [...reached].filter((file) => file.startsWith(GIT_DIR))

	return git_files.filter((file) =>
		[...(forward.get(file) ?? [])].some((target) => is_epic(target)),
	)
}

describe('epic layering', () => {
	const forward = import_graph.build_forward(runtime_sources(), ROOT)

	it('walks a graph in which the epic domain reaches the git layer', () => {
		const epic_files = [...forward.keys()].filter((file) => is_epic(file))

		expect(reachable_from(epic_files, forward).has(GH_COMMAND)).toBe(true)
	})

	it('has no git module the epic domain depends on that imports the epic domain back', () => {
		expect(back_edges(forward).map((file) => path.relative(ROOT, file))).toEqual([])
	})

	it('reports a module that closes the cycle back into the epic domain', () => {
		const epic_file = path.join(EPIC_DIR, 'epic-x.ts')
		const git_file = path.join(GIT_DIR, 'git-x.ts')
		const cyclic: FileGraph = new Map([
			[epic_file, new Set([git_file])],
			[git_file, new Set([epic_file])],
		])

		expect(back_edges(cyclic)).toEqual([git_file])
	})
})
