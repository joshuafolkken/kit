// The screenshot-target routes a change touches, derived from the diff rather than chosen by eye
// (joshuafolkken/kit#2182).
//
// The `verify-ui` skill's §1 asked the reader to read `git diff` and name the routes whose
// components, styles or copy it touches — but in SvelteKit a file path maps to a route path
// mechanically, so the candidate list is computed. What stays a judgement is the narrowing "pick the
// ones a reader would notice"; this module produces the candidates that judgement chooses from.
//
// A changed route file (`+page`/`+layout`) contributes its own route; a changed shared component
// contributes the routes that render it, found through an injected `find_importers` so the file-system
// scan stays in the CLI and this derivation stays pure. The import scan is one level deep: a component
// imported only by another component, never directly by a route, yields no candidate here.

const ROUTES_PREFIX = 'src/routes/'
const SVELTE_EXTENSION = '.svelte'
const ROUTE_SEPARATOR = '/'
// A route-defining file renders UI: `+page*` is the page, `+layout*` wraps it. `+server`/`+error` are
// not screenshot targets, so they are treated as shared files (imported by nothing, they contribute
// nothing).
const ROUTE_FILE_PATTERN = /^\+(page|layout)\b/u

function is_under_routes(file: string): boolean {
	return file.startsWith(ROUTES_PREFIX)
}

function base_name(file: string): string {
	return file.slice(file.lastIndexOf(ROUTE_SEPARATOR) + 1)
}

function is_route_file(file: string): boolean {
	return is_under_routes(file) && ROUTE_FILE_PATTERN.test(base_name(file))
}

// A `.svelte` file that is not a route file — a `$lib` component, or a component that sits beside
// routes. Its own path names no route, so its routes are its importers'.
function is_shared_svelte(file: string): boolean {
	return file.endsWith(SVELTE_EXTENSION) && !is_route_file(file)
}

// A route group directory — `(marketing)` — is organizational and contributes no URL segment, so it
// is dropped from the path (SvelteKit routing).
function is_group_segment(segment: string): boolean {
	return segment.startsWith('(') && segment.endsWith(')')
}

function route_path_of(file: string): string | undefined {
	if (!is_route_file(file)) return undefined

	const segments = file
		.slice(ROUTES_PREFIX.length)
		.split(ROUTE_SEPARATOR)
		.slice(0, -1)
		.filter((segment) => !is_group_segment(segment))

	return `${ROUTE_SEPARATOR}${segments.join(ROUTE_SEPARATOR)}`
}

function is_route(value: string | undefined): value is string {
	return value !== undefined
}

function routes_via_component(
	component: string,
	find_importers: (component: string) => ReadonlyArray<string>,
): Array<string> {
	return find_importers(component)
		.map((importer) => route_path_of(importer))
		.filter(is_route)
}

function routes_of_path(
	file: string,
	find_importers: (component: string) => ReadonlyArray<string>,
): Array<string> {
	const direct = route_path_of(file)
	if (direct !== undefined) return [direct]
	if (!is_shared_svelte(file)) return []

	return routes_via_component(file, find_importers)
}

// The screenshot-target candidates for a set of changed paths, deduplicated and ordered. An empty
// result is the honest "no route derived" the CLI reports rather than guessing.
function derive_routes(
	changed: ReadonlyArray<string>,
	find_importers: (component: string) => ReadonlyArray<string>,
): Array<string> {
	const routes = changed.flatMap((file) => routes_of_path(file, find_importers))

	return [...new Set(routes)].toSorted((first, second) => first.localeCompare(second))
}

const ui_routes = {
	derive_routes,
	is_route_file,
	is_shared_svelte,
	route_path_of,
	ROUTES_PREFIX,
	SVELTE_EXTENSION,
}

export { ui_routes }
