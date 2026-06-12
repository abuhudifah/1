import js from '@eslint/js';

export default [
  {
    // Apply to all project JS files
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'coverage/**', '*.min.js', 'tests/**', 'supabase/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        // Browser built-ins
        window: 'readonly',
        document: 'readonly',
        sessionStorage: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
        Promise: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        URL: 'readonly',
        prompt: 'readonly',
        alert: 'readonly',
        location: 'readonly',
        history: 'readonly',
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        ResizeObserver: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        HTMLElement: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        FormData: 'readonly',
        // Third-party globals
        lucide: 'readonly',
        Dexie: 'readonly',
      },
    },
    rules: {
      // Only enforce the rules specified in the task
      'no-empty': ['error', { allowEmptyCatch: false }],
      'eqeqeq': ['error', 'always'],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      'semi': ['error', 'always'],
      // Disable rules that produce false positives in script-tag-loaded projects
      'no-undef': 'off',
      'no-redeclare': 'off',
    },
  },
];
