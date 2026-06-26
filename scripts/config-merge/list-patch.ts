// Shared, serialization-agnostic core for the config-merge library. Both the YAML (cspell
// `import`) and JSON (tsconfig `extends`) patchers compute their next list here so the
// ensure/remove semantics are single-sourced: ensure entries are prepended (preserving the
// established `[new, ...existing]` ordering), remove entries are dropped by exact string or
// pattern match, and `is_changed` reports whether the list actually differs from the input.

// A remove matcher: an exact string to drop, or a pattern every matching entry is dropped by.
type ListEntryMatcher = string | RegExp

interface ListPatch {
	ensure?: ReadonlyArray<string>
	remove?: ReadonlyArray<ListEntryMatcher>
}

interface ListPatchResult {
	next: ReadonlyArray<string>
	is_changed: boolean
}

function is_matching(entry: string, matchers: ReadonlyArray<ListEntryMatcher>): boolean {
	return matchers.some((matcher) =>
		typeof matcher === 'string' ? matcher === entry : matcher.test(entry),
	)
}

function apply_remove(
	existing: ReadonlyArray<string>,
	remove: ReadonlyArray<ListEntryMatcher> | undefined,
): ReadonlyArray<string> {
	if (remove === undefined || remove.length === 0) return existing

	return existing.filter((entry) => !is_matching(entry, remove))
}

function collect_additions(
	kept: ReadonlyArray<string>,
	ensure: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
	if (ensure === undefined) return []

	return ensure.filter((entry) => !kept.includes(entry))
}

// Drop `remove` matches, then prepend any `ensure` entry not already present. `is_changed` is true
// when an entry was added or removed, so a caller can return the original content untouched (and
// keep its comments/formatting) on a no-op — which also makes re-runs idempotent.
function apply_list_patch(existing: ReadonlyArray<string>, patch: ListPatch): ListPatchResult {
	const kept = apply_remove(existing, patch.remove)
	const additions = collect_additions(kept, patch.ensure)
	const is_changed = additions.length > 0 || kept.length !== existing.length

	return { next: [...additions, ...kept], is_changed }
}

const list_patch = {
	is_matching,
	apply_list_patch,
}

export type { ListEntryMatcher, ListPatch, ListPatchResult }
export { list_patch }
