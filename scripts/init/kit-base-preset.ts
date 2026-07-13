// Detect whether a consumer's managed-config list already references a `@joshuafolkken/*`
// preset for a given subsystem (lefthook / cspell / tsconfig). Every ecosystem preset — kit's
// own base as well as an app-kit / game-kit framework preset — embeds, extends, or imports kit
// base by construction, so the presence of ANY such entry means kit base is already layered
// exactly once. `josh sync` uses these predicates to avoid adding a SECOND kit-base reference
// (which double-extends `lefthook/base.yml` into a hard recursion crash, and redundantly re-imports
// the cspell / tsconfig base). Matching the consumer's own config content — not the dependency
// tree — keeps the check source-of-truth-driven and free of any hardcoded package name.

// A lefthook `extends` path such as `node_modules/@joshuafolkken/app-kit/lefthook/sveltekit.yml`
// or `node_modules/@joshuafolkken/kit/lefthook/vanilla.yml`.
const KIT_LEFTHOOK_PRESET = /@joshuafolkken\/[^/]+\/lefthook\//u
// A cspell `import` value such as `@joshuafolkken/app-kit/cspell/sveltekit` or the bare base
// `@joshuafolkken/kit/cspell` (hence the trailing `/`-or-end alternation).
const KIT_CSPELL_PRESET = /@joshuafolkken\/[^/]+\/cspell(?:\/|$)/u
// A tsconfig `extends` path such as `./node_modules/@joshuafolkken/app-kit/tsconfig/sveltekit.jsonc`
// or `./node_modules/@joshuafolkken/kit/tsconfig/base.jsonc`.
const KIT_TSCONFIG_PRESET = /@joshuafolkken\/[^/]+\/tsconfig\//u
// A `*/sveltekit` framework preset referenced by an in-repo RELATIVE path that carries no
// `@joshuafolkken/` prefix — the shape a self-hosting repo (app-kit's own repo) uses, e.g.
// `./tsconfig/sveltekit.jsonc`, `./cspell/sveltekit.yaml`, `lefthook/sveltekit.yml`. Such a preset
// re-exports / inlines kit base by construction, so kit base must not be injected alongside it. The
// KIT_*_PRESET regexes above only catch the installed-dependency form (`@joshuafolkken/…/sveltekit`);
// this segment-anchored fallback covers the prefix-less relative form. The `(?<![\w-])` /
// `(?![\w-])` boundaries anchor `sveltekit` to a complete path segment — mirroring app-kit's
// config-patch anchoring — so a `sveltekit-*` / `*-sveltekit` sibling and hyphenated `svelte-kit`
// are left untouched. See joshuafolkken/kit#664.
const SVELTEKIT_PRESET = /(?<![\w-])sveltekit(?![\w-])/u

function has_match(entries: ReadonlyArray<string>, pattern: RegExp): boolean {
	return entries.some((entry) => pattern.test(entry))
}

// True when any entry references kit base for this subsystem (via a `@joshuafolkken/*` preset) or a
// prefix-less `*/sveltekit` framework preset that re-exports it — either means kit base is already
// layered exactly once, so `josh sync` must skip injecting a second base reference.
function is_base_present(entries: ReadonlyArray<string>, subsystem_pattern: RegExp): boolean {
	return has_match(entries, subsystem_pattern) || has_match(entries, SVELTEKIT_PRESET)
}

function is_lefthook_base_present(entries: ReadonlyArray<string>): boolean {
	return is_base_present(entries, KIT_LEFTHOOK_PRESET)
}

function is_cspell_base_present(entries: ReadonlyArray<string>): boolean {
	return is_base_present(entries, KIT_CSPELL_PRESET)
}

function is_tsconfig_base_present(entries: ReadonlyArray<string>): boolean {
	return is_base_present(entries, KIT_TSCONFIG_PRESET)
}

const kit_base_preset = {
	is_lefthook_base_present,
	is_cspell_base_present,
	is_tsconfig_base_present,
}

export { kit_base_preset }
