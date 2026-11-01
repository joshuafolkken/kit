import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { import_move, type MoveRequest } from './import-move'
import { rename_identifier } from './rename-identifier'

// joshuafolkken/kit#5792: PR #5783 (joshuafolkken/kit#5757) pointed the importers of
// `agent-role-profile.ts` at narrower modules, splitting `import { A, B } from X` by hand in 22 files.

const FILE = 'lane-session-action.ts'
const ROLE_PROFILE = '#scripts/agent/agent-role-profile'
const PROVIDER_MOVE: MoveRequest = {
	name: 'AgentProvider',
	from: ROLE_PROFILE,
	to: '#scripts/agent/agent-provider',
}
const BARE_MOVE: MoveRequest = { name: 'b', from: './x', to: './y' }

// `lane-session-action.ts` and `run-cut.ts` as they stood before PR #5783, folded into one fixture.
const BEFORE = `import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_role_profile, type AgentProvider } from '#scripts/agent/agent-role-profile'
import { api_auth } from '#scripts/agent/api-auth'

const { PRE_GATE_PHASE, IMPLEMENTATION_PHASE } = agent_role_profile
const phase = agent_role_profile.IMPLEMENTATION_PHASE
`
// The same lines as PR #5783 left them.
const AFTER = `import { agent_argv } from '#scripts/agent/agent-argv'
import { agent_profile_schema } from '#scripts/agent/agent-profile-schema'
import type { AgentProvider } from '#scripts/agent/agent-provider'
import { api_auth } from '#scripts/agent/api-auth'

const { PRE_GATE_PHASE, IMPLEMENTATION_PHASE } = agent_profile_schema
const phase = agent_profile_schema.IMPLEMENTATION_PHASE
`

function moved(text: string, request: MoveRequest = BARE_MOVE): string {
	return import_move.rewrite(ts, FILE, text, request).text
}

describe('import_move.rewrite — the PR #5783 split', () => {
	it('produces the same lines as PR #5783 with the rename that follows it', () => {
		const split = import_move.rewrite(ts, FILE, BEFORE, PROVIDER_MOVE)
		const renamed = rename_identifier.rewrite(ts, FILE, split.text, {
			old_name: 'agent_role_profile',
			new_name: 'agent_profile_schema',
			specifier: [ROLE_PROFILE, '#scripts/agent/agent-profile-schema'],
		})

		expect(split).toMatchObject({ count: 1, is_taken: false })
		expect(renamed.text).toBe(AFTER)
	})

	it('takes the new specifier when the name was alone in its declaration', () => {
		expect(moved("import { b } from './x'\n\nb()\n")).toBe("import { b } from './y'\n\nb()\n")
	})

	it('keeps a default import and an alias', () => {
		expect(moved("import a, { b as c } from './x'\n")).toBe(
			"import a from './x'\nimport { b as c } from './y'\n",
		)
	})
})

describe('import_move.rewrite — keeps a type-only name type-only', () => {
	it('moves a name out of an import type declaration as an import type', () => {
		expect(moved("import type { a, b } from './x'\n")).toBe(
			"import type { a } from './x'\nimport type { b } from './y'\n",
		)
	})

	it('keeps the double quotes the declaration was written with', () => {
		expect(moved('import { a, b } from "./x"\n')).toBe(
			'import { a } from "./x"\nimport { b } from "./y"\n',
		)
	})
})

describe('import_move.rewrite — leaves what is not the named import', () => {
	it('leaves string literals, property keys and other modules alone', () => {
		const text =
			"import { a, b } from './x'\nimport { b as z } from './w'\n\nconst k = { b: 'b', './x': obj.b }\n"
		const result = moved(text)

		expect(result).toBe(
			"import { a } from './x'\nimport { b } from './y'\nimport { b as z } from './w'\n\nconst k = { b: 'b', './x': obj.b }\n",
		)
	})

	it('changes nothing in a file that does not import the name from the old module', () => {
		const text = "import { a } from './x'\nimport { b } from './w'\nconst s = 'b'\n"

		expect(import_move.rewrite(ts, FILE, text, BARE_MOVE)).toStrictEqual({
			text,
			count: 0,
			is_taken: false,
		})
	})

	it('changes nothing in a file that imports the name twice from the old module', () => {
		const text = "import { b as c, b } from './x'\n"

		expect(import_move.rewrite(ts, FILE, text, BARE_MOVE).count).toBe(0)
	})
})

describe('import_move.rewrite — cuts only the name and its comma', () => {
	it('keeps a comment inside the braces', () => {
		expect(moved("import {\n\ta, // keep\n\tb,\n} from './x'\n")).toBe(
			"import {\n\ta, // keep\n\t\n} from './x'\nimport { b } from './y'\n",
		)
	})

	it('skips a comma inside a comment after the name', () => {
		expect(moved("import { b /* x, y */, d } from './x'\n")).toBe(
			"import { d } from './x'\nimport { b } from './y'\n",
		)
	})

	it('skips a comma inside a comment before the last name', () => {
		expect(moved("import { a /* x, y */, b } from './x'\n")).toBe(
			"import { a /* x, y */ } from './x'\nimport { b } from './y'\n",
		)
	})

	it('cuts a name that is not the last one with the comma after it', () => {
		expect(moved("import { b, c } from './x'\n")).toBe(
			"import { c } from './x'\nimport { b } from './y'\n",
		)
	})

	it('moves an inline type name in a mixed list as an import type', () => {
		expect(moved("import { a, type b } from './x'\n")).toBe(
			"import { a } from './x'\nimport type { b } from './y'\n",
		)
	})
})
