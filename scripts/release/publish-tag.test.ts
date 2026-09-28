import { expect, it } from 'vitest'
import { publish_tag } from './publish-tag'

it('keeps latest on the highest version when versions arrive in reverse order', () => {
	expect(publish_tag('1.889.0', '1.887.0')).toBe('latest')
	expect(publish_tag('1.888.0', '1.889.0')).toBe('backfill')
})

it('rejects an unreadable current latest rather than risking a rollback', () => {
	expect(() => publish_tag('1.889.0', '')).toThrow('valid semantic versions')
})
