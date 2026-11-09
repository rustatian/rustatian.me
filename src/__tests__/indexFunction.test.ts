import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

type Handler = (event: { request: { uri: string } }) => Promise<{ uri: string }>;

// The code of the CloudFront Function is the block under FunctionCode in the template.
// Node runs the same JavaScript, so this checks the logic and not the CloudFront runtime.
const template = readFileSync(path.resolve(__dirname, '../../infra/template.yaml'), 'utf8');
const code = template.match(/FunctionCode: \|\n((?: {8}.*\n)+)/)?.[1];
if (!code) throw new Error('infra/template.yaml has no FunctionCode block');
const handler = new Function(`${code}return handler;`)() as Handler;

const cases = [
  { name: 'home page', uri: '/', want: '/index.html' },
  { name: 'page without a slash', uri: '/about', want: '/about/index.html' },
  { name: 'page with a slash', uri: '/about/', want: '/about/index.html' },
  { name: 'contact page', uri: '/contact', want: '/contact/index.html' },
  { name: 'explicit file', uri: '/index.html', want: '/index.html' },
  { name: 'user data', uri: '/api/v1/github/user', want: '/api/v1/github/user' },
  {
    name: 'contributions data',
    uri: '/api/v1/github/contributions',
    want: '/api/v1/github/contributions',
  },
  { name: 'unknown page', uri: '/nope', want: '/nope/index.html' },
  { name: 'hashed asset', uri: '/assets/index-B_61Bltt.js', want: '/assets/index-B_61Bltt.js' },
  { name: 'sitemap', uri: '/sitemap.xml', want: '/sitemap.xml' },
  { name: 'direct 404 path', uri: '/404', want: '/404/index.html' },
];

it.each(cases)('$name', async ({ uri, want }) => {
  expect((await handler({ request: { uri } })).uri).toBe(want);
});
