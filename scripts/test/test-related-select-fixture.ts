import { vi } from 'vitest'
import type { RelatedScope } from './test-related-scope'
import type { test_related_select as SelectApi, Selection } from './test-related-select'

// The selection `josh test:related`'s end-to-end tests run through (joshuafolkken/kit#7976): it selects
// nothing and cuts nothing, so the scope reaches vitest as resolved and a test reads the run around it;
// a test that feeds `select` a selection gets the real scope of it. A test mocks the module with
// `vi.mock('./test-related-select', async () => await import('./test-related-select-fixture'))`;
// `test-related-select.test.ts` fixes the selection itself.

interface SelectModule {
	test_related_select: typeof SelectApi
}

const NOTHING_SELECTED: Selection = { tests: [], deferred: [], reach: [], method: 'import' }

const actual = await vi.importActual<SelectModule>('./test-related-select')

function scope_of(root: string, scope: RelatedScope, selection: Selection): RelatedScope {
	if (selection.tests.length === 0) return scope

	return actual.test_related_select.scope_of(root, scope, selection)
}

const test_related_select: typeof SelectApi = {
	...actual.test_related_select,
	select: vi.fn(async () => NOTHING_SELECTED),
	scope_of,
}

export { test_related_select }
