import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'import-meta-resolve'
import ts from 'typescript'

// joshuafolkken/kit#1347: ESLint decides a cache entry is still valid from the file's own content
// hash plus a hash of the **serialized** config, and serializing drops every function — so the
// `create` of each rule under `rules/` is not in it. Edit `rules/naming-convention.js` and every
// entry already in the cache stays valid: the gate's `josh lint` then reports the pre-edit verdict
// for every file the change did not touch, and the edit hook's own cache does the same. Both were
// there from the day `--cache` was added (joshuafolkken/kit#1256), and the gate side is the wider
// exposure of the two.
//
// **This is the one place both sides are fixed from.** Every eslint run in a kit project — the
// gate's whole-tree lint, `josh lint:related`, the `PostToolUse` edit hook, `josh health`, and a
// consumer's own run — loads its config through `create_base_config`, so a value placed here reaches
// each of their cache files at once. `settings` is where it goes because `settings` survives
// serialization while a rule's `create` does not: measured against ESLint's own cache, two configs
// differing only in this value produced `hashOfConfig` `a84wo9` and `1bi5fu4`, which invalidates
// every entry in whichever file the run was pointed at.
//
// **Nothing reads the value.** Being inside the serialized config is the whole of its job, and no
// rule or plugin is meant to look it up.
//
// **It is a content fingerprint rather than a version, an mtime or a random token** because it has
// to agree across machines: CI restores the gate's cache (`.github/workflows/ci.yml` → "Setup ESLint
// cache"), and a value that differed per checkout would make every CI lint cold while reporting a
// cache hit. Content also means an edit that changes nothing but whitespace in a rule module does
// invalidate — the safe direction, and the same direction `--cache-strategy content` already picked
// for the files themselves.
//
// **Its scope is the modules of this directory the config loads, not the consumer's config entry
// file.** A consumer that writes an inline rule implementation directly in its own `eslint.config.js`
// is outside the fingerprint: that file's serializable content is already part of ESLint's hash, its
// `create` functions are not, and this preset cannot locate a file it is not given. Rule
// implementations belong in a module the preset composes, which is what every kit project does.
//
// joshuafolkken/kit#5380: **a module counts only when an import chain from a config entry reaches
// it** — this preset's `base.js`, which every kit config loads, and the project's own
// `eslint.config.*`. A rule module not yet wired in changes no file's lint result, so adding or
// editing one must not throw every cache entry away; the commit that wires it changes the importing
// module, and the module joins the fingerprint there. The `.test.ts` files beside the modules are
// never imported, so a test edit keeps the cache warm too.

const HASH_ALGORITHM = 'sha256'
// Half of a sha256 is far more than a cache key needs, and it keeps the value readable when the
// calculated config is dumped for debugging.
const FINGERPRINT_LENGTH = 32
// Namespaced by the package rather than by a plugin, because no plugin owns it. A plugin key would
// read as configuration something is meant to consume.
const SETTINGS_KEY = 'kit_config_fingerprint'
const PRESET_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const PRESET_ENTRY = 'base.js'
const MODULE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']
const CONFIG_ENTRY_NAMES = MODULE_EXTENSIONS.map((extension) => `eslint.config${extension}`)

function is_file(file) {
	return statSync(file, { throwIfNoEntry: false })?.isFile() === true
}

// The files a specifier may name: itself, then what a TypeScript config's resolution adds — a missing
// extension, a directory's `index`, and a `.js` written for the `.ts` beside it.
function module_candidates(target) {
	const typed = target.replace(/\.([cm]?)js$/u, '.$1ts')
	const bare = MODULE_EXTENSIONS.map((extension) => `${target}${extension}`)
	const indexes = MODULE_EXTENSIONS.map((extension) => path.join(target, `index${extension}`))

	return [target, typed, ...bare, ...indexes]
}

function resolve_module(target) {
	return module_candidates(target).find((candidate) => is_file(candidate))
}

function is_inside(relative_path) {
	return relative_path !== '' && !relative_path.startsWith('..') && !path.isAbsolute(relative_path)
}

function is_local_module(target) {
	return (
		path.isAbsolute(target) &&
		(!target.split(path.sep).includes('node_modules') ||
			is_inside(path.relative(PRESET_DIRECTORY, target)))
	)
}

function keep_path_spelling(file, target) {
	const directory = path.dirname(file)
	const relative = path.relative(realpathSync(directory), target)

	return path.resolve(directory, relative)
}

function resolve_es_module(specifier, file) {
	const url = resolve(specifier, pathToFileURL(file).href)

	return url.startsWith('file:') ? fileURLToPath(url) : ''
}

function resolve_commonjs_module(specifier, file) {
	return createRequire(file).resolve(specifier)
}

// Third-party packages are versioned by the lockfile; only project files and this preset need their
// implementation hashed. Resolving a specifier never executes the module it names.
function resolve_package_import(file, specifier, resolver) {
	try {
		const target = resolver(specifier, file)

		// Node resolves symlinks, while entries may use a checkout alias such as macOS's /tmp. Keep
		// that spelling so relative names still belong to the directory being fingerprinted.
		return is_local_module(target) ? [keep_path_spelling(file, target)] : []
	} catch {
		return []
	}
}

function resolve_import(file, specifier) {
	const relative = specifier.startsWith('.')
		? [resolve_module(path.resolve(path.dirname(file), specifier))]
		: []

	// A source may mix import() and require(); including both conditional branches avoids dropping
	// a loaded module while the lockfile still accounts for third-party dependencies.
	return [
		...relative,
		...resolve_package_import(file, specifier, resolve_es_module),
		...resolve_package_import(file, specifier, resolve_commonjs_module),
	]
}

function list_imports(file) {
	const source = readFileSync(file, 'utf8')

	return ts
		.preProcessFile(source, true, true)
		.importedFiles.flatMap((entry) => resolve_import(file, entry.fileName))
		.filter((resolved) => resolved !== undefined)
}

function visit_module(file, reached, pending) {
	if (reached.has(file) || !is_file(file)) return

	reached.add(file)
	pending.push(...list_imports(file))
}

// The absolute paths of every module an import chain from `entries` reaches, the entries included. A
// specifier that names no file is dropped: Node refuses to load it, so it configures nothing.
/**
 * @param {ReadonlyArray<string>} entries
 * @returns {ReadonlySet<string>}
 */
function list_reachable_modules(entries) {
	/** @type {Set<string>} */
	const reached = new Set()
	const pending = [...entries]

	while (pending.length > 0) visit_module(pending.pop(), reached, pending)

	return reached
}

// The project's own config entry files that exist under `project_root`, as absolute paths.
/**
 * @param {string} project_root
 * @returns {Array<string>}
 */
function list_config_entries(project_root) {
	return CONFIG_ENTRY_NAMES.map((name) => path.join(project_root, name)).filter((file) =>
		is_file(file),
	)
}

function default_entries(directory, project_root) {
	const project_entries = project_root === undefined ? [] : list_config_entries(project_root)

	return [path.join(directory, PRESET_ENTRY), ...project_entries]
}

// Code-unit order rather than `localeCompare`: the fingerprint has to be identical on every machine
// that reads the same sources, and a locale-aware comparison is by definition not.
function compare_source_names(left, right) {
	if (left === right) return 0

	return left < right ? -1 : 1
}

// Sorted, relative to the directory being read, and always with forward slashes. Each of the three is
// what keeps the value the same on two machines: a traversal guarantees no order, an absolute path
// carries the checkout location into the hash, and `path.sep` would make a Windows checkout disagree
// with the CI cache it restores. A reached module outside `directory` is left out — the project's own
// entry file is already in ESLint's hash.
function list_config_sources(directory, entries) {
	return [...list_reachable_modules(entries)]
		.map((file) => path.relative(directory, file))
		.filter((relative_path) => is_inside(relative_path))
		.map((relative_path) => relative_path.split(path.sep).join('/'))
		.toSorted(compare_source_names)
}

// The relative path is hashed beside the content so that renaming a rule module, or moving one
// between directories, changes the fingerprint too — a rename changes which files the config
// applies and would otherwise be invisible here.
//
// The `NUL` between them is what keeps the concatenation unambiguous: fed straight into one digest,
// a byte moved from the end of a name into the start of the next file's content would hash the same,
// and a fingerprint that silently fails to change is the one failure this file exists to prevent.
function compute_config_fingerprint(
	directory = PRESET_DIRECTORY,
	entries = default_entries(directory),
) {
	const digest = createHash(HASH_ALGORITHM)

	for (const relative_path of list_config_sources(directory, entries)) {
		digest.update(`${relative_path}\0`)
		digest.update(readFileSync(path.join(directory, relative_path)))
		digest.update('\0')
	}

	return digest.digest('hex').slice(0, FINGERPRINT_LENGTH)
}

// A config block of its own, carrying no `files`, so it applies to every file the run lints. Given
// `files`, the entries for everything outside that glob would keep the old config hash and the whole
// point would be lost on exactly the files a rule edit is least likely to be tested against.
// `project_root` is where the project's `eslint.config.*` lives — kit's own wires a module of this
// directory the preset does not (`rules/english-only-prose.js`).
function create_config_fingerprint_block(project_root) {
	const entries = default_entries(PRESET_DIRECTORY, project_root)

	return { settings: { [SETTINGS_KEY]: compute_config_fingerprint(PRESET_DIRECTORY, entries) } }
}

const config_fingerprint = {
	SETTINGS_KEY,
	compute_config_fingerprint,
	create_config_fingerprint_block,
	list_config_entries,
	list_reachable_modules,
}

export { config_fingerprint }
