import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { ui_routes } from './ui-routes'
import { ui_routes_cli } from './ui-routes-cli'

const COMMAND = 'ui:routes'
const SCRIPT_PATH = 'scripts/ui/ui-routes-cli.ts'
const ALIAS = 'uir'
const SHARED_COMPONENT = 'src/lib/Button.svelte'
const ABOUT_PAGE = 'src/routes/about/+page.svelte'

function no_importers(): Array<string> {
	return []
}

function importers_of(component: string): Array<string> {
	return component === SHARED_COMPONENT ? [ABOUT_PAGE] : []
}

describe('ui_routes.derive_routes — a directly changed page', () => {
	it('derives the route from the page path', () => {
		expect(ui_routes.derive_routes([ABOUT_PAGE], no_importers)).toEqual(['/about'])
	})

	it('maps the root page to /', () => {
		expect(ui_routes.derive_routes(['src/routes/+page.svelte'], no_importers)).toEqual(['/'])
	})

	it('keeps a dynamic segment and drops a route group', () => {
		const changed = ['src/routes/(marketing)/blog/[slug]/+page.svelte']

		expect(ui_routes.derive_routes(changed, no_importers)).toEqual(['/blog/[slug]'])
	})
})

describe('ui_routes.derive_routes — a shared component', () => {
	it('traces the component to the routes that render it', () => {
		expect(ui_routes.derive_routes([SHARED_COMPONENT], importers_of)).toEqual(['/about'])
	})

	it('yields nothing when no route imports it', () => {
		expect(ui_routes.derive_routes(['src/lib/Unused.svelte'], no_importers)).toEqual([])
	})
})

describe('ui_routes.derive_routes — no candidate', () => {
	it('derives nothing from a change that renders no screen', () => {
		expect(ui_routes.derive_routes(['scripts/foo.ts', 'README.md'], no_importers)).toEqual([])
	})
})

describe('ui:routes flag parsing', () => {
	it('reads --staged', () => {
		expect(ui_routes_cli.parse_staged(['--staged'])).toBe(true)
	})

	it('defaults to the branch diff', () => {
		expect(ui_routes_cli.parse_staged([])).toBe(false)
	})

	it('refuses an unknown flag rather than guessing', () => {
		expect(ui_routes_cli.parse_staged(['--nope'])).toBeUndefined()
	})
})

describe('ui:routes registration', () => {
	it('is on the command map', () => {
		expect(COMMAND_MAP[COMMAND]?.script).toBe(SCRIPT_PATH)
	})

	it('is reachable by its alias', () => {
		expect(ALIASES[ALIAS]).toBe(COMMAND)
	})

	it('states the flag it accepts in its usage line', () => {
		expect(ui_routes_cli.USAGE).toContain('--staged')
	})
})
