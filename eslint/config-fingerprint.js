import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
// **Its scope is this directory, not the consumer's config entry file.** A consumer that writes an
// inline rule implementation directly in its own `eslint.config.js` is outside the fingerprint: that
// file's serializable content is already part of ESLint's hash, its `create` functions are not, and
// this preset cannot locate a file it is not given. Rule implementations belong in a module the
// preset composes, which is what every kit project does.

const HASH_ALGORITHM = 'sha256'
// Half of a sha256 is far more than a cache key needs, and it keeps the value readable when the
// calculated config is dumped for debugging.
const FINGERPRINT_LENGTH = 32
// What serialization drops: the modules in this directory are loaded as code. The `.test.ts` files
// beside them are not config inputs at all, so the extension list is what leaves them out — a test
// edit must not throw away a warm cache.
const CONFIG_SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])
// Namespaced by the package rather than by a plugin, because no plugin owns it. A plugin key would
// read as configuration something is meant to consume.
const SETTINGS_KEY = 'kit_config_fingerprint'
const PRESET_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))

// Code-unit order rather than `localeCompare`: the fingerprint has to be identical on every machine
// that reads the same sources, and a locale-aware comparison is by definition not.
function compare_source_names(left, right) {
	if (left === right) return 0

	return left < right ? -1 : 1
}

// Sorted, relative to the directory being read, and always with forward slashes. Each of the three is
// what keeps the value the same on two machines: `readdirSync` guarantees no order, an absolute path
// carries the checkout location into the hash, and `path.sep` would make a Windows checkout disagree
// with the CI cache it restores.
function list_config_sources(directory) {
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && CONFIG_SOURCE_EXTENSIONS.has(path.extname(entry.name)))
		.map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
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
function compute_config_fingerprint(directory = PRESET_DIRECTORY) {
	const digest = createHash(HASH_ALGORITHM)

	for (const relative_path of list_config_sources(directory)) {
		digest.update(`${relative_path}\0`)
		digest.update(readFileSync(path.join(directory, relative_path)))
		digest.update('\0')
	}

	return digest.digest('hex').slice(0, FINGERPRINT_LENGTH)
}

// A config block of its own, carrying no `files`, so it applies to every file the run lints. Given
// `files`, the entries for everything outside that glob would keep the old config hash and the whole
// point would be lost on exactly the files a rule edit is least likely to be tested against.
function create_config_fingerprint_block(directory = PRESET_DIRECTORY) {
	return { settings: { [SETTINGS_KEY]: compute_config_fingerprint(directory) } }
}

const config_fingerprint = {
	SETTINGS_KEY,
	compute_config_fingerprint,
	create_config_fingerprint_block,
}

export { config_fingerprint }
