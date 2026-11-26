import { describe, expectTypeOf, it } from 'vitest'
import type {
	Cell,
	FinalCell,
	Grid,
	Point,
	ThemeApi,
	ThemeFactory,
	ThemeModule,
	ThemePart,
	ThemeState,
} from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the shapes a theme port writes against — a factory over the host's api
// returning a theme module, which draws into the grid from the state and the tick.

describe('run_board_theme_host_types', () => {
	it('builds a theme module from the api', () => {
		expectTypeOf<ThemeFactory>().parameters.toEqualTypeOf<[ThemeApi]>()
		expectTypeOf<ThemeFactory>().returns.toEqualTypeOf<ThemeModule>()
	})

	it('draws into a grid of [character, style] cells from the state and the tick', () => {
		expectTypeOf<Grid>().toEqualTypeOf<Array<Array<Cell>>>()
		expectTypeOf<Cell>().toEqualTypeOf<[string, string]>()
		expectTypeOf<FinalCell>().toEqualTypeOf<[string, string, string]>()
		expectTypeOf<ThemeModule['draw']>().parameters.toEqualTypeOf<[Grid, ThemeState, number]>()
		expectTypeOf<ThemePart['draw']>().parameters.toEqualTypeOf<[Grid, number, ThemeState]>()
	})

	it('puts text at a point, in a style or the cells’ own', () => {
		expectTypeOf<ThemeApi['put']>().parameter(0).toEqualTypeOf<Grid>()
		expectTypeOf<ThemeApi['put']>().parameter(1).toEqualTypeOf<Point>()
		expectTypeOf<ThemeApi['put']>().parameter(2).toEqualTypeOf<string>()
		expectTypeOf<ThemeApi['put']>().parameter(3).toEqualTypeOf<string | undefined>()
	})
})
