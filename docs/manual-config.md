# Manual config

For `node` projects that import kit's ESLint, Prettier and tsconfig presets by hand instead of running `josh init`. Use individual configs directly if you prefer not to use `josh init`:

Install the optional ESLint dependencies listed in [package.md](./package.md#1-install) before importing the ESLint preset. A kit-only installation does not include them. The same preset import works before and after this change.

```js
// eslint.config.js
import { create_vanilla_config } from '@joshuafolkken/kit/eslint/vanilla'
```

```js
// prettier.config.js
import { config } from '@joshuafolkken/kit/prettier'
```

For Svelte formatting, also install `prettier-plugin-svelte` and `svelte` in the project. The kit package itself does not require Svelte.

```jsonc
// tsconfig.json
{ "extends": ["@joshuafolkken/kit/tsconfig/base"] }
```

```yaml
# cspell.config.yaml
import:
  - node_modules/@joshuafolkken/kit/cspell/index.yaml
```

```yaml
# lefthook.yml
extends:
  - node_modules/@joshuafolkken/kit/lefthook/vanilla.yml
```
