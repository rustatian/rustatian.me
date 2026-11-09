import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const read = (file: string) => readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

// CSP matches an inline script by the base64 SHA-256 of its text, so an edit to the
// theme script in index.html needs the new hash in the CloudFront policy.
// https://www.w3.org/TR/CSP3/#match-element-to-source-list
it('allows the inline theme script by its hash in the CloudFront policy', () => {
  const script = read('index.html').match(/<script>(.*?)<\/script>/s)?.[1] ?? '';
  expect(script).not.toBe('');
  const digest = createHash('sha256').update(script).digest('base64');
  expect(read('infra/template.yaml')).toContain(`'sha256-${digest}'`);
});
