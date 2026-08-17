import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { package_path } from './init/init-paths'
import { yaml_document } from './yaml-document'

// Every guard that asserts on a YAML config the kit ships — cspell dictionaries, lefthook presets,
// the workspace manifest, the distributed Dependabot policy — reads it exactly the same way.
// Single-sourced here so the resolve/read/parse plumbing exists once instead of once per suite.
//
// Resolved from the package root rather than process.cwd() so a test keeps reading the file it
// names no matter which directory the runner was started in.
//
// Deliberately NOT routed through yaml_document.parse_yaml: that helper maps an empty or
// comment-only document to {} because a production reader treats it as "nothing declared". A test
// guard needs the opposite — a truncated config that yields {} makes every "the file declares X"
// assertion pass vacuously — so a malformed or non-mapping document fails loudly here instead.
// The mapping predicate itself is shared with that module; only the empty-document shim is not.
function load_yaml_config(relative_path: string): unknown {
	const parsed = load(readFileSync(package_path(relative_path), 'utf8'))
	if (yaml_document.is_mapping_document(parsed)) return parsed

	throw new Error(`${relative_path} did not parse as a YAML mapping document`)
}

const yaml_config_fixture = { load_yaml_config }

export { yaml_config_fixture }
