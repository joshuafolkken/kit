import { describe, expect, it } from 'vitest'
import { cost_audit_tool, type ToolCategory } from './cost-audit-tool'

const CODE_SEARCH: ToolCategory = 'code search'
const DOC_READ: ToolCategory = 'doc read'
const ORCHESTRATION: ToolCategory = 'orchestration'
const ISSUE_OPS: ToolCategory = 'issue ops'
const VERIFICATION: ToolCategory = 'verification'

describe('cost_audit_tool.category_of — a tool call is filed by the work it did', () => {
	it.each([
		['Grep', CODE_SEARCH],
		['Read', DOC_READ],
		['Edit', 'edit'],
		['Agent', ORCHESTRATION],
		['UnknownTool', cost_audit_tool.OTHER],
	])('files the %s tool as %s', (name, category) => {
		expect(cost_audit_tool.category_of(name, {})).toBe(category)
	})

	it.each([
		['pnpm josh lint:related a.ts', VERIFICATION],
		['pnpm josh gate', VERIFICATION],
		['pnpm josh issue:read 1', ISSUE_OPS],
		['pnpm josh doc:section a.md "b"', DOC_READ],
		['pnpm josh run:step 1', ORCHESTRATION],
		['grep -n x a.ts', CODE_SEARCH],
		['sed -n 1,5p a.ts', DOC_READ],
		['gh api repos/a/b', ISSUE_OPS],
		['make', cost_audit_tool.OTHER],
	])('files the Bash command %j by what it ran, as %s', (command, category) => {
		expect(cost_audit_tool.category_of('Bash', { command })).toBe(category)
	})
})
