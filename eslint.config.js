import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { languageOptions: { globals: globals.node } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ["lib/**/*"] },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
    }
  }
];