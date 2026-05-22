import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

// Flat-config ESLint (v9 style). Strict TypeScript + React. Zero warnings
// allowed per the constitution's quality gate.
export default [
  {
    ignores: [
      "dist/**",
      "dist-server/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
        // projectService auto-discovers the nearest tsconfig per file, which
        // lets the type-aware rules in strict-type-checked actually run
        // (otherwise @typescript-eslint silently degrades to non-type-aware
        // mode). Constitution mandates strict-type-checked, see line 19.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    settings: { react: { version: "detect" } },
    rules: {
      // Strict type-checked rules per constitution.md (no-unsafe-*,
      // no-floating-promises, prefer-nullish-coalescing, and more).
      // Falls back to recommended if strict-type-checked isn't exported,
      // which keeps lint working across @typescript-eslint minor versions.
      ...(tsPlugin.configs["strict-type-checked"]?.rules ??
        tsPlugin.configs.strict?.rules ??
        tsPlugin.configs.recommended.rules),
      ...(tsPlugin.configs["stylistic-type-checked"]?.rules ?? {}),
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
];
