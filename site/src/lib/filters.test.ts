import { describe, expect, it } from 'vitest';
import { TARGETS, inTarget, isDevelopmentBranch } from './filters';

describe('the development branch', () => {
  it('is master, and no other branch', () => {
    expect(isDevelopmentBranch('master')).toBe(true);
    expect(isDevelopmentBranch('main')).toBe(false);
    expect(isDevelopmentBranch('release-1.21')).toBe(false);
    expect(['main', 'master', 'release-1.21', 'wip-feature', 'Master', 'master-old'].filter(isDevelopmentBranch)).toEqual([
      'master',
    ]);
  });

  it('is what the master target keeps, and every other branch is under backports', () => {
    expect(TARGETS[0]).toEqual({ id: 'master', label: 'master' });
    expect(inTarget('master', 'master')).toBe(true);
    expect(inTarget('master', 'release-1.21')).toBe(false);
    expect(inTarget('backports', 'release-1.21')).toBe(true);
    expect(inTarget('backports', 'master')).toBe(false);
    expect(inTarget('all', 'release-1.21')).toBe(true);
  });
});
