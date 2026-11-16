import { describe, expect, it } from 'vitest';
import { MARK_STYLES } from './timeline';
import { glyphPath } from './timeline-glyphs';

describe('glyphPath', () => {
  it('draws every glyph the styles use', () => {
    for (const style of Object.values(MARK_STYLES)) expect(glyphPath(style.glyph, 5).d).toMatch(/^M/);
  });
});
