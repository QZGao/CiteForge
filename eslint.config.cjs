const tseslint = require('@typescript-eslint/eslint-plugin');
const parser = require('@typescript-eslint/parser');

const typeChecked = tseslint.configs['recommended-type-checked'] || {};

module.exports = [
	{
		ignores: ['dist/**', 'node_modules/**']
	},
	{
		files: ['src/**/*.{ts,tsx}'],
		languageOptions: {
			parser,
			parserOptions: {
				project: ['./tsconfig.json'],
				tsconfigRootDir: __dirname,
				ecmaVersion: 2021,
				sourceType: 'module'
			}
		},
		plugins: {
			'@typescript-eslint': tseslint
		},
		rules: {
			...(typeChecked.rules || {}),
			'@typescript-eslint/no-explicit-any': 'warn'
		}
	}
];
