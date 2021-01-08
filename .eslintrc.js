"use strict";

module.exports = {
    env: {
        node: true,
        es2021: true,
        mocha: true,
    },
    extends: ["eslint:recommended", "plugin:mocha/recommended"],
    parserOptions: {
        ecmaVersion: 12,
    },
    rules: {
        "no-constant-condition": "off",
        "no-empty": "off",
        "no-unused-vars": [
            2,
            { vars: "all", args: "all", argsIgnorePattern: "^_", ignoreRestSiblings: false },
        ],
    },
    ignorePatterns: ["resumable.js"],
    plugins: ["mocha"],
};