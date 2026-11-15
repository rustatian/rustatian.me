import { render } from '@testing-library/preact';
import { useEffect } from 'preact/hooks';
import { describe, expect, it } from 'vitest';

// Preact 11 runs the useEffect cleanups of an unmounted tree on the next animation frame.
// A cleanup that runs after Vitest closes jsdom throws an unhandled error.
let cleanups = 0;

const Probe = () => {
  useEffect(
    () => () => {
      cleanups += 1;
    },
    [],
  );
  return null;
};

describe('test cleanup', () => {
  it('mounts a component with an effect cleanup', () => {
    render(<Probe />);
    expect(cleanups).toBe(0);
  });

  it('runs the effect cleanups of the previous test before the next test', () => {
    expect(cleanups).toBe(1);
  });
});
