// Shared builders for the overrides tests, so `overrides-logic.test.ts` and
// `overrides-held-back.test.ts` read one definition instead of each keeping a copy.
function make_overrides(entries: Array<[string, string]>): Record<string, string> {
	return Object.fromEntries(entries)
}

function make_package_json(
	deps: Record<string, string>,
	development_deps: Record<string, string>,
): string {
	return JSON.stringify({
		dependencies: deps,
		devDependencies: development_deps,
	})
}

const overrides_fixture = {
	make_overrides,
	make_package_json,
	CAPPED_PKG_KEY: 'some-pkg@>=5',
	CAPPED_PKG_VALUE: '^4',
}

export { overrides_fixture }
