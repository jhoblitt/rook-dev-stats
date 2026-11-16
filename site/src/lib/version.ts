export const REPO_URL = 'https://github.com/jhoblitt/rook-dev-stats';

export interface VersionLink {
  label: string;
  /** The release page, or null for a dev build. */
  href: string | null;
}

/** Formats the build's APP_VERSION, with or without its leading `v`. */
export function formatVersion(raw: string | undefined): VersionLink {
  const bare = (raw ?? '').trim().replace(/^v/, '');
  if (bare === '') return { label: 'dev', href: null };
  const tag = `v${bare}`;
  return { label: tag, href: `${REPO_URL}/releases/tag/${tag}` };
}
