import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

// joshuafolkken/kit#1107: `.claude` is a shipped directory, and Claude Code puts its bridge work
// trees at `.claude/worktrees/<name>/` — a full checkout of this repository, carrying its own
// `node_modules`. A flat `readdirSync(recursive: true)` read all of it: the checkout's `docs/`,
// which the package deliberately does not ship and which is therefore free to quote a command the
// distribution forbids, and every vendored `CHANGELOG.md` beneath it. `gh-document-guard.test.ts`
// then failed on files no consumer will ever receive, while its own `scans only what the package
// ships` assertion still passed — the path that one pins is `docs/sync.md`, and the path being read
// was `.claude/worktrees/<name>/docs/sync.md`.
//
// The prune needs a walk of its own, which is why this is not a filter over the flat listing: a
// recursive listing offers nowhere to stop descending, so a nested checkout is read in full before
// anything can drop it.
//
// It lives in a fixture rather than in the suite because a fixture is excluded from the published
// package (`!**/*-fixture.ts` in `files`) while being importable by every document suite that needs
// to know what the package ships.
const NESTED_PACKAGES = 'node_modules'
// A nested checkout carries `.git` whichever kind it is — a directory for a clone or a submodule, a
// file for a work tree — so one existence test covers all three, and none of them is ours to read.
const CHECKOUT_MARKER = '.git'
const MARKDOWN_EXTENSION = '.md'

function is_scannable(parent: string, name: string): boolean {
	return name !== NESTED_PACKAGES && !existsSync(path.join(parent, name, CHECKOUT_MARKER))
}

function under(prefix: string, names: ReadonlyArray<string>): Array<string> {
	return names.map((name) => `${prefix}/${name}`)
}

// Self-recursive rather than a pair of mutually recursive halves: `no-use-before-define` refuses
// whichever of the two is written second, and no ordering satisfies it.
function markdown_files_under(directory: string): Array<string> {
	const entries = readdirSync(directory, { encoding: 'utf8', withFileTypes: true })
	const documents = entries
		.filter((entry) => !entry.isDirectory() && entry.name.endsWith(MARKDOWN_EXTENSION))
		.map((entry) => entry.name)
	const descend = entries.filter(
		(entry) => entry.isDirectory() && is_scannable(directory, entry.name),
	)

	return [
		...documents,
		...descend.flatMap((entry) =>
			under(entry.name, markdown_files_under(path.join(directory, entry.name))),
		),
	]
}

export { markdown_files_under, MARKDOWN_EXTENSION }
