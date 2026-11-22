/** @type {import("prettier").Config} */
const config = {
	useTabs: true,
	singleQuote: true,
	trailingComma: 'none',
	printWidth: 100,
	// Windows checkouts hold CRLF (core.autocrlf); keep whatever a file already has.
	endOfLine: 'auto',
	plugins: ['prettier-plugin-svelte', 'prettier-plugin-astro', 'prettier-plugin-tailwindcss'],
	overrides: [
		{ files: '*.svelte', options: { parser: 'svelte' } },
		{ files: '*.astro', options: { parser: 'astro' } }
	],
	tailwindStylesheet: './apps/web/src/routes/layout.css'
};

export default config;
