/** Root ESLint config — apps/packages extend this via packages/config/eslint/base.js */
module.exports = {
  root: true,
  extends: ['./packages/config/eslint/base.js'],
  ignorePatterns: ['dist', '.next', 'node_modules', '**/*.js'],
};
