import { readdirSync } from 'node:fs'
import path from 'node:path'
import { import_graph, type FileGraph } from '#scripts/refactor/import-graph'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2904: the epic code used to live in two directories that imported each other —
// `scripts/epic/` read `scripts/git/git-epic-*`, and six of those read `scripts/epic/` back, with the
// GitHub I/O layer itself reading an epic type. The direction is now one-way: the epic domain builds
// on the git layer, and no git-layer module the epic domain depends on may depend on the epic domain
// in turn. A module that consumes the epic domain from above (the followup that closes a finished
// epic) stays allowed, because no epic module reaches it.

const ROOT = process.cwd()
const SCRIPTS = path.join(ROOT, 'scripts')
const EPIC_DIR = `${path.join(SCRIPTS, 'epic')}${path.sep}`
const GIT_DIR = `${path.join(SCRIPTS, 'git')}${path.sep}`
// The git layer after joshuafolkken/kit#2988 split it: `scripts/git/` plus each directory that
// received a module the epic domain reaches (GitHub I/O, issue labels, the spinner). A directory the
// epic domain does not reach (`notify/`) is left out — the test below keeps this list to directories
// that are reached. `issue/` and `lib/` also hold modules from elsewhere; those pass only while no
// epic module reaches them. `scripts/followup/` is left out on purpose — it closes a finished epic,
// consuming the epic domain from above.
const LOWER_DIRS = ['git', 'gh', 'issue', 'lib'].map(
	(name) => `${path.join(SCRIPTS, name)}${path.sep}`,
)
const TEST_SUFFIX = '.test.ts'
const SOURCE_SUFFIX = '.ts'
// A module the epic domain must reach, so an empty walk cannot pass the rule vacuously.
const GH_COMMAND = path.join(SCRIPTS, 'gh', 'git-gh-command.ts')

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

function is_lower(file: string): boolean {
	return LOWER_DIRS.some((directory) => file.startsWith(directory))
}

function reached_from_epic(forward: FileGraph): ReadonlySet<string> {
	return reachable_from(
		[...forward.keys()].filter((file) => is_epic(file)),
		forward,
	)
}

// Every git-layer module the epic domain reaches that imports it back.
function back_edges(forward: FileGraph): ReadonlyArray<string> {
	const lower_files = [...reached_from_epic(forward)].filter((file) => is_lower(file))

	return lower_files.filter((file) =>
		[...(forward.get(file) ?? [])].some((target) => is_epic(target)),
	)
}

describe('epic layering', () => {
	const forward = import_graph.build_forward(runtime_sources(), ROOT)

	it('walks a graph in which the epic domain reaches the git layer', () => {
		expect(reached_from_epic(forward).has(GH_COMMAND)).toBe(true)
	})

	it('names only git-layer directories the epic domain actually reaches', () => {
		const reached = [...reached_from_epic(forward)]
		const unreached = LOWER_DIRS.filter((directory) =>
			reached.every((file) => !file.startsWith(directory)),
		)

		expect(unreached.map((directory) => path.relative(ROOT, directory))).toEqual([])
	})

	it('has no git-layer module the epic domain depends on that imports the epic domain back', () => {
		expect(back_edges(forward).map((file) => path.relative(ROOT, file))).toEqual([])
	})
})

// A graph in which each file imports the next and the last imports the first.
function cycle_of(files: ReadonlyArray<string>): FileGraph {
	return new Map(
		files.map((file, index) => [file, new Set([files[(index + 1) % files.length] ?? file])]),
	)
}

describe('epic layering back edges', () => {
	const epic_file = path.join(EPIC_DIR, 'epic-x.ts')

	it('reports a module that closes the cycle back into the epic domain', () => {
		const git_file = path.join(GIT_DIR, 'git-x.ts')

		expect(back_edges(cycle_of([epic_file, git_file]))).toEqual([git_file])
	})

	it('reports a cycle closed from a module moved out of the git layer', () => {
		const gh_file = path.join(SCRIPTS, 'gh', 'git-gh-x.ts')

		expect(back_edges(cycle_of([epic_file, gh_file]))).toEqual([gh_file])
	})

	it('reports a cycle closed through a module outside the git layer', () => {
		const middle_file = path.join(SCRIPTS, 'backlog', 'backlog-x.ts')
		const lower_file = path.join(SCRIPTS, 'issue', 'issue-x.ts')

		expect(back_edges(cycle_of([epic_file, middle_file, lower_file]))).toEqual([lower_file])
	})

	it('allows a module that imports the epic domain without being reached from it', () => {
		const consumer_file = path.join(SCRIPTS, 'followup', 'followup-x.ts')
		const graph: FileGraph = new Map([
			[epic_file, new Set<string>()],
			[consumer_file, new Set([epic_file])],
		])

		expect(back_edges(graph)).toEqual([])
	})
})
