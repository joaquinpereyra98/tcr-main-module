import globals from "globals";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import css from "@eslint/css";
import html from "@html-eslint/eslint-plugin"
import htmlParser, { TEMPLATE_ENGINE_SYNTAX } from "@html-eslint/parser";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { files: ["**/*.{js,mjs,cjs}"], languageOptions: { globals: globals.browser } },
  { files: ["**/*.json"], plugins: { json }, language: "json/json" },
  { files: ["**/*.md"], plugins: { markdown }, language: "markdown/gfm" },
  { files: ["**/*.css"], plugins: { css }, language: "css/css" },
  {
    files: ["**/*.{html,hbs}"],
    plugins: {
      html
    },
    extends: ["html/recommended"],
    language: "html/html",
    languageOptions: {
      parser: htmlParser,
      templateEngineSyntax: TEMPLATE_ENGINE_SYNTAX.HANDLEBAR
    },
  },
]);
