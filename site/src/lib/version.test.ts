import { describe, expect, it } from 'vitest';
import { REPO_URL, formatVersion } from './version';

const release = `${REPO_URL}/releases/tag/v1.2.3`;

describe('formatVersion', () => {
  it('keeps a v-prefixed version as is', () => {
    expect(formatVersion('v1.2.3')).toEqual({ label: 'v1.2.3', href: release });
  });

  it('adds the v to a bare version', () => {
    expect(formatVersion('1.2.3')).toEqual({ label: 'v1.2.3', href: release });
  });

  it.each([undefined, '', '  ', 'v'])('is dev with no link for %j', (raw) => {
    expect(formatVersion(raw)).toEqual({ label: 'dev', href: null });
  });

  it('trims surrounding whitespace', () => {
    expect(formatVersion(' v1.2.3\n')).toEqual({ label: 'v1.2.3', href: release });
  });

  it('points at the repository', () => {
    expect(REPO_URL).toBe('https://github.com/jhoblitt/rook-dev-stats');
  });
});
