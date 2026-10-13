import { parse_jsonc } from '#scripts/config-merge/parse-jsonc'
import { json_value } from '#scripts/lib/json-value'
import { init_logic_json_merge } from './init-logic-json-merge'
import { kit_development_versions } from './kit-development-versions'

// The tools a consumer has to resolve itself, as opposed to the ones only kit's own ESLint config
// imports. Those are optional kit peers, which pnpm does not install unlisted, so a consumer still
// needs them — `josh init` writes them, `josh sync` leaves them to it (#3711). A tool belongs here
// when the consumer runs its bin from the project root (eslint, prettier, tsc, playwright, cspell,
// lefthook), when a config the consumer owns imports it (`playwright.config.ts` → @playwright/test,
// @types/node), or when it is named by a string Prettier resolves from the consumer (the preset's
// plugins). `josh init` and `josh sync` both read this one list, so a tool added here reaches a fresh
// project and an already-initialized one alike.
const CONSUMER_RESOLVED_TOOLS = [
	'eslint',
	'prettier',
	'typescript',
	'@playwright/test',
	'@ianvs/prettier-plugin-sort-imports',
	'prettier-plugin-svelte',
	'prettier-plugin-tailwindcss',
	'cspell',
	'@types/node',
]
// Only a project with Git gets `lefthook.yml`, so only that one needs the bin.
const LEFTHOOK_DEVELOPMENT_DEPENDENCY = 'lefthook'
const DECLARING_FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
]

function consumer_resolved_names(has_git: boolean): ReadonlyArray<string> {
	return has_git
		? [...CONSUMER_RESOLVED_TOOLS, LEFTHOOK_DEVELOPMENT_DEPENDENCY]
		: CONSUMER_RESOLVED_TOOLS
}

// What `josh init` adds: every kit peer — the ones only kit's own configs import included — and the
// tools above. Versions mirror kit's own devDependencies, so the consumer runs the toolchain kit is
// verified with.
function get_toolchain_development_dependencies(has_git: boolean): Record<string, string> {
	return kit_development_versions.versions_of([
		...kit_development_versions.peer_names(),
		...consumer_resolved_names(has_git),
	])
}

function is_declared(manifest: Record<string, unknown>, name: string): boolean {
	return DECLARING_FIELDS.some((field) => {
		const dependencies = manifest[field]

		return json_value.is_record(dependencies) && Object.hasOwn(dependencies, name)
	})
}

// What `josh sync` adds to an already-initialized consumer: only the tools above, and only the ones
// the manifest declares nowhere — a tool kept under `dependencies` is present, not missing.
function merge_consumer_resolved_development_deps(content: string, has_git: boolean): string {
	const manifest = parse_jsonc(content)
	const missing = consumer_resolved_names(has_git).filter((name) => !is_declared(manifest, name))

	return init_logic_json_merge.merge_development_dependencies(
		content,
		kit_development_versions.versions_of(missing),
	)
}

const init_logic_toolchain = {
	consumer_resolved_names,
	get_toolchain_development_dependencies,
	merge_consumer_resolved_development_deps,
}

export { init_logic_toolchain }
