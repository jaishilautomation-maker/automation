import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Ban type="number" in JSX — use NumericInput component instead.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='type'][value.value='number']",
          message:
            'Do not use type="number" in inputs. Use the NumericInput component instead to prevent scroll-wheel value changes and unwanted number formatting.',
        },
      ],
    },
  },
]);

export default eslintConfig;
