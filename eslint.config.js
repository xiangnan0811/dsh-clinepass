import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['node_modules/**', '.tmp/**', 'src/client/**'] },
  {
    files: ['lib/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: { globals: globals.node, ecmaVersion: 'latest' },
    rules: { 'no-undef': js.configs.recommended.rules['no-undef'] },
  },
  {
    files: ['lib/client.js'],
    languageOptions: { globals: globals.browser },
  },
]
