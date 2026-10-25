import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "src/types/database.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Plain Node scripts use CommonJS so they can load the globally installed Playwright.
  { files: ["scripts/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
];

export default config;
