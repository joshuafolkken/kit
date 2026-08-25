import { readFileSync } from 'node:fs'
import path from 'node:path'

// `josh sync` / `josh-app sync` / `josh-game sync` all copy a distribution package's files into a
// consumer project. Run inside the package's OWN repository the direction reverses: the source of
// truth is overwritten by the derived template, and the copy transforms fire against a project
// where they are wrong (a `prompts/…` reference rewritten to `node_modules/@joshuafolkken/kit/…`
// resolves nowhere, a workflow written from `templates/` loses the pins `.github/workflows` owns).
// joshuafolkken/game-kit#447 is the incident; joshuafolkken/kit#868 reproduced the same damage in
// kit — 14 files, including CLAUDE.md, tsconfig.json and both mapped workflows.
//
// The check lives here rather than in each package's sync so the three distributors share one
// implementation: a second copy would drift, and a distributor that spelled the signal differently
// would keep exactly the hole this closes.
const MANIFEST_NAME = 'package.json'

function read_package_name(directory: string): string | undefined {
	try {
		const manifest: unknown = JSON.parse(readFileSync(path.join(directory, MANIFEST_NAME), 'utf8'))
		if (typeof manifest !== 'object' || manifest === null) return undefined
		const { name } = manifest as { name?: unknown }

		return typeof name === 'string' ? name : undefined
	} catch {
		// A missing, unreadable or malformed manifest says nothing about self-sync, and refusing to
		// sync on it would break consumers whose manifest this package is about to create.
		return undefined
	}
}

function is_same_directory(first: string, second: string): boolean {
	return path.resolve(first) === path.resolve(second)
}

// Is `inner` the same directory as `outer`, or somewhere beneath it? Asked in one direction only.
// The reverse is the ordinary consumer layout — the package sits at
// `<project>/node_modules/@joshuafolkken/kit`, so the PACKAGE directory is always inside the
// PROJECT root — and refusing on that would refuse every sync there is.
function is_within(inner: string, outer: string): boolean {
	const relative = path.relative(path.resolve(outer), path.resolve(inner))

	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

// The name is the primary signal, not the path: game-kit's incident ran a GLOBAL install of the
// package against its own repository, so `package_directory` and `project_root` were different
// directories and a path comparison alone would have missed it.
function name_reason(
	package_name: string | undefined,
	project_name: string | undefined,
): string | undefined {
	return package_name !== undefined && package_name === project_name
		? `this is ${package_name}'s own repository`
		: undefined
}

// Reached only when the project has no readable manifest to name it, which is the whole of what
// makes containment usable here: a real consumer scaffolded under the checkout (a fixture at
// `kit/tmp/consumer`) is nested too, and its manifest names it as something other than this package.
// The nested case is `pnpm josh sync` run from `kit/docs`, where the sync would otherwise scatter a
// consumer's worth of managed files inside the repository.
function location_reason(package_directory: string, project_root: string): string | undefined {
	if (is_same_directory(package_directory, project_root)) {
		return 'the package directory and the project root are the same directory'
	}

	return is_within(project_root, package_directory)
		? 'the project root is inside the package directory'
		: undefined
}

function self_sync_reason(package_directory: string, project_root: string): string | undefined {
	const project_name = read_package_name(project_root)
	const by_name = name_reason(read_package_name(package_directory), project_name)

	if (by_name !== undefined) return by_name

	return project_name === undefined ? location_reason(package_directory, project_root) : undefined
}

// The message a sync prints before refusing. Phrased as what was detected plus what to do instead,
// because the command is usually reached by habit ("re-sync after upgrading") and the user needs to
// know nothing is wrong with their checkout.
function self_sync_refusal(package_directory: string, project_root: string): string | undefined {
	const reason = self_sync_reason(package_directory, project_root)

	if (reason === undefined) return undefined

	return [
		`Refusing to sync: ${reason}.`,
		'Syncing here would overwrite the distribution source with its own derived templates.',
		'Run this command from a consumer project instead.',
	].join('\n')
}

const self_sync_guard = { self_sync_reason, self_sync_refusal, read_package_name }

export { self_sync_guard }
