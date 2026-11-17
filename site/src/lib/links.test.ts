import { describe, expect, it } from 'vitest';
import { commitUrl, eventUrl, prUrl } from './links';

const REPO = 'rook/rook';
const SHA = '4315b600657d926645efaaa79d8cc1d5651bba02';

describe('prUrl', () => {
  it('is the pull request page', () => {
    expect(prUrl(REPO, 66500)).toBe('https://github.com/rook/rook/pull/66500');
  });
});

describe('commitUrl', () => {
  it('is the commit within the pull request', () => {
    expect(commitUrl(REPO, 66500, SHA)).toBe(`https://github.com/rook/rook/pull/66500/commits/${SHA}`);
  });

  it('is null for an empty or malformed SHA', () => {
    expect(commitUrl(REPO, 66500, '')).toBeNull();
    expect(commitUrl(REPO, 66500, 'not-a-sha')).toBeNull();
  });
});

describe('eventUrl', () => {
  const pr = 'https://github.com/rook/rook/pull/66500';

  it.each(['comment_other', 'comment_author', 'command_author', 'command_other', 'bot_account'])(
    'addresses a %s as an issue comment',
    (kind) => {
      expect(eventUrl(REPO, 66500, kind, '3401926760')).toBe(`${pr}#issuecomment-3401926760`);
    },
  );

  it.each(['review_approved', 'review_changes', 'review_commented', 'bot_review', 'review_author'])(
    'addresses a %s as a review',
    (kind) => {
      expect(eventUrl(REPO, 66500, kind, '2902306922')).toBe(`${pr}#pullrequestreview-2902306922`);
    },
  );

  it.each(['ready', 'draft', 'closed'])('addresses a %s event by its id', (kind) => {
    expect(eventUrl(REPO, 66500, kind, '20020304409')).toBe(`${pr}#event-20020304409`);
  });

  it.each(['merged', 'force_push'])('addresses a %s as the commit it made', (kind) => {
    expect(eventUrl(REPO, 66500, kind, SHA)).toBe(`https://github.com/rook/rook/commit/${SHA}`);
  });

  it('sends a reopening, which has no address, to the pull request', () => {
    expect(eventUrl(REPO, 66500, 'reopened', '')).toBe(pr);
  });

  it.each([
    'comment_other',
    'review_approved',
    'review_author',
    'bot_review',
    'ready',
    'draft',
    'closed',
    'merged',
    'force_push',
  ])('has no address for a %s whose ref was not recorded', (kind) => {
    expect(eventUrl(REPO, 66500, kind, '')).toBeNull();
  });

  it('builds no address from a ref of the wrong form', () => {
    expect(eventUrl(REPO, 66500, 'comment_other', SHA)).toBeNull();
    expect(eventUrl(REPO, 66500, 'merged', '3401926760')).toBeNull();
    expect(eventUrl(REPO, 66500, 'ready', '12"><script>')).toBeNull();
  });

  it('sends a kind it does not know to the pull request', () => {
    expect(eventUrl(REPO, 66500, 'labelled', '123')).toBe(pr);
  });
});
