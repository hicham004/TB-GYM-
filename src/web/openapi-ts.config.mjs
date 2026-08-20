/** @type {import('@hey-api/openapi-ts').UserConfig} */
export default {
  input: process.env.TB_GYM_OPENAPI_URL ?? 'http://localhost:5134/openapi/v1.json',
  output: 'src/app/core/api/generated',
  plugins: ['@hey-api/typescript'],
};
