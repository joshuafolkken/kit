import { describe, expect, it } from 'vitest'
import {
	ai_review_pull_comment_schema,
	package_name_schema,
	pr_info_schema,
	pr_raw_schema,
	pull_comment_schema,
	rollup_item_schema,
} from './schemas'

const PACKAGE_NAME = '@joshuafolkken/kit'
const STATUS_CONTEXT = 'StatusContext'
const BUILD_NAME = 'Build'
const FIX_THIS = 'Fix this'
const CODERABBIT_LOGIN = 'coderabbitai[bot]'
const GITHUB_COMMENT_URL = 'https://github.com/pr/1#c1'
const CLAUDE_LOGIN = 'claude'
const NON_OBJECT_STRING = 'not-an-object'
const PARSES_EMPTY_OBJECT = 'parses empty object'
const FAILS_FOR_NON_OBJECT = 'fails for non-object'

describe('package_name_schema', () => {
	it('parses valid package name', () => {
		const result = package_name_schema.safeParse({ name: PACKAGE_NAME })

		expect(result.success).toBe(true)
		if (result.success) expect(result.data.name).toBe(PACKAGE_NAME)
	})

	it('fails when name is missing', () => {
		expect(package_name_schema.safeParse({}).success).toBe(false)
	})

	it('fails when name is empty string', () => {
		expect(package_name_schema.safeParse({ name: '' }).success).toBe(false)
	})

	it('fails for non-object input', () => {
		expect(package_name_schema.safeParse(NON_OBJECT_STRING).success).toBe(false)
	})
})

describe('rollup_item_schema', () => {
	it('parses StatusContext item', () => {
		// eslint-disable-next-line @typescript-eslint/naming-convention -- __typename is a GraphQL field name
		const result = rollup_item_schema.safeParse({ __typename: STATUS_CONTEXT, state: 'SUCCESS' })

		expect(result.success).toBe(true)

		if (result.success) {
			// eslint-disable-next-line dot-notation, @typescript-eslint/dot-notation -- bracket notation prevents naming-convention violation on __typename
			expect(result.data['__typename']).toBe(STATUS_CONTEXT)
			expect(result.data.state).toBe('SUCCESS')
		}
	})

	it('parses CheckRun item', () => {
		const result = rollup_item_schema.safeParse({
			status: 'COMPLETED',
			conclusion: 'SUCCESS',
			name: BUILD_NAME,
		})

		expect(result.success).toBe(true)
		if (result.success) expect(result.data.name).toBe(BUILD_NAME)
	})

	it('passes through unknown fields', () => {
		const result = rollup_item_schema.safeParse({ name: 'CI', extra_field: 'preserved' })

		expect(result.success).toBe(true)
		// eslint-disable-next-line dot-notation -- index signature field requires bracket notation
		if (result.success) expect(result.data['extra_field']).toBe('preserved')
	})

	it(PARSES_EMPTY_OBJECT, () => {
		expect(rollup_item_schema.safeParse({}).success).toBe(true)
	})

	it(FAILS_FOR_NON_OBJECT, () => {
		expect(rollup_item_schema.safeParse(NON_OBJECT_STRING).success).toBe(false)
	})
})

describe('pr_raw_schema', () => {
	it('parses PR state with all fields', () => {
		const input = {
			statusCheckRollup: [{ name: 'CodeRabbit', status: 'COMPLETED', conclusion: 'SUCCESS' }],
			mergeStateStatus: 'CLEAN',
			reviewDecision: 'APPROVED',
		}
		const result = pr_raw_schema.safeParse(input)

		expect(result.success).toBe(true)

		if (result.success) {
			expect(result.data.mergeStateStatus).toBe('CLEAN')
			expect(result.data.reviewDecision).toBe('APPROVED')
			expect(result.data.statusCheckRollup).toHaveLength(1)
		}
	})

	it('parses empty object as valid with all fields undefined', () => {
		const result = pr_raw_schema.safeParse({})

		expect(result.success).toBe(true)

		if (result.success) {
			expect(result.data.mergeStateStatus).toBeUndefined()
			expect(result.data.statusCheckRollup).toBeUndefined()
		}
	})

	it(FAILS_FOR_NON_OBJECT, () => {
		expect(pr_raw_schema.safeParse('invalid-json').success).toBe(false)
	})
})

describe('pull_comment_schema', () => {
	it('parses comment with all fields', () => {
		const input = {
			body: FIX_THIS,
			html_url: GITHUB_COMMENT_URL,
			user: { login: CODERABBIT_LOGIN },
		}
		const result = pull_comment_schema.safeParse(input)

		expect(result.success).toBe(true)

		if (result.success) {
			expect(result.data.body).toBe(FIX_THIS)
			expect(result.data.user?.login).toBe(CODERABBIT_LOGIN)
		}
	})

	it(PARSES_EMPTY_OBJECT, () => {
		expect(pull_comment_schema.safeParse({}).success).toBe(true)
	})

	it('parses array of comments', () => {
		const input = [{ body: 'a' }, { html_url: 'https://github.com/1' }]
		const result = pull_comment_schema.array().safeParse(input)

		expect(result.success).toBe(true)
		if (result.success) expect(result.data).toHaveLength(2)
	})

	it('fails array parse when item has wrong field type', () => {
		const input = [{ user: 'string-not-object' }]

		expect(pull_comment_schema.array().safeParse(input).success).toBe(false)
	})
})

describe('ai_review_pull_comment_schema', () => {
	it('parses comment with author login', () => {
		const input = {
			body: 'Issue found',
			url: 'https://github.com/pr/1#r1',
			author: { login: CLAUDE_LOGIN },
		}
		const result = ai_review_pull_comment_schema.safeParse(input)

		expect(result.success).toBe(true)
		if (result.success) expect(result.data.author?.login).toBe(CLAUDE_LOGIN)
	})

	it(PARSES_EMPTY_OBJECT, () => {
		expect(ai_review_pull_comment_schema.safeParse({}).success).toBe(true)
	})

	it('parses array of AI review comments', () => {
		const input = [{ body: 'a', author: { login: CLAUDE_LOGIN } }]
		const result = ai_review_pull_comment_schema.array().safeParse(input)

		expect(result.success).toBe(true)
	})
})

describe('pr_info_schema', () => {
	it('parses boolean mergeable', () => {
		const result = pr_info_schema.safeParse({
			mergeable: true,
			mergeStateStatus: 'CLEAN',
			state: 'OPEN',
		})

		expect(result.success).toBe(true)

		if (result.success) {
			expect(result.data.mergeable).toBe(true)
			expect(result.data.state).toBe('OPEN')
		}
	})

	it('parses string mergeable (CONFLICTING)', () => {
		const result = pr_info_schema.safeParse({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' })

		expect(result.success).toBe(true)
		if (result.success) expect(result.data.mergeable).toBe('CONFLICTING')
	})

	it('parses null mergeable', () => {
		// eslint-disable-next-line unicorn/no-null -- testing nullable schema field
		const result = pr_info_schema.safeParse({ mergeable: null })

		expect(result.success).toBe(true)
		if (result.success) expect(result.data.mergeable).toBeNull()
	})

	it(PARSES_EMPTY_OBJECT, () => {
		expect(pr_info_schema.safeParse({}).success).toBe(true)
	})

	it(FAILS_FOR_NON_OBJECT, () => {
		expect(pr_info_schema.safeParse(42).success).toBe(false)
	})
})
