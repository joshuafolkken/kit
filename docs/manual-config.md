# Manual config

Use individual configs directly if you prefer not to use `josh init`:

```js
// eslint.config.js
import { create_sveltekit_config } from '@joshuafolkken/kit/eslint/sveltekit'
// or
import { create_vanilla_config } from '@joshuafolkken/kit/eslint/vanilla'
```

```js
// prettier.config.js
import { config } from '@joshuafolkken/kit/prettier'
```

```jsonc
// tsconfig.json
{ "extends": ["@joshuafolkken/kit/tsconfig/base"] }
// or sveltekit:
{ "extends": [".svelte-kit/tsconfig.json", "@joshuafolkken/kit/tsconfig/sveltekit"] }
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
  # or sveltekit.yml
```
