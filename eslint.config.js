import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/*.tsbuildinfo'] },
  ...tseslint.configs.recommended,
);
