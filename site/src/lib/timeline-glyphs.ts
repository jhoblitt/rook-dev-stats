// The shapes of the marks on a PR's timeline.

export type Glyph =
  | 'circle'
  | 'ring'
  | 'square'
  | 'hollowSquare'
  | 'triangle'
  | 'hollowTriangle'
  | 'hollowDown'
  | 'diamond'
  | 'hollowDiamond'
  | 'check'
  | 'cross'
  | 'star'
  | 'half'
  | 'target'
  | 'rewind'
  | 'arrow';

/**
 * A mark's shape centred on 0,0, about `r` from its centre to its edge. A
 * solid shape is filled with the kind's colour and ringed in the surface
 * colour; a hollow one is outlined in it; a stroked one is drawn as lines.
 * `inner` adds a filled part to a hollow shape: the half of `half`, the
 * centre of `target`.
 */
export function glyphPath(glyph: Glyph, r: number): { d: string; fill: 'solid' | 'hollow' | 'stroke'; inner?: string } {
  const n = (v: number) => Math.round(v * 100) / 100;
  const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${n(x)},${n(y)}`).join('L')}Z`;
  const circle = (k: number) => `M${n(k)},0A${n(k)},${n(k)} 0 1 1 ${n(-k)},0A${n(k)},${n(k)} 0 1 1 ${n(k)},0Z`;
  const square = (k: number) => poly([[-k, -k], [k, -k], [k, k], [-k, k]]);
  const up = (k: number) => poly([[0, -k * 1.1], [k, k * 0.75], [-k, k * 0.75]]);
  const diamond = (k: number) => poly([[0, -k * 1.2], [k * 0.9, 0], [0, k * 1.2], [-k * 0.9, 0]]);
  switch (glyph) {
    case 'circle':
      return { d: circle(r), fill: 'solid' };
    case 'ring':
      return { d: circle(r * 0.85), fill: 'hollow' };
    case 'square':
      return { d: square(r * 0.85), fill: 'solid' };
    case 'hollowSquare':
      return { d: square(r * 0.75), fill: 'hollow' };
    case 'triangle':
      return { d: up(r), fill: 'solid' };
    case 'hollowTriangle':
      return { d: up(r * 0.9), fill: 'hollow' };
    case 'hollowDown':
      return { d: poly([[0, r], [r * 0.95, -r * 0.7], [-r * 0.95, -r * 0.7]]), fill: 'hollow' };
    case 'diamond':
      return { d: diamond(r), fill: 'solid' };
    case 'hollowDiamond':
      return { d: diamond(r * 0.9), fill: 'hollow' };
    case 'check':
      return { d: `M${n(-r * 0.85)},${n(r * 0.05)}L${n(-r * 0.25)},${n(r * 0.7)}L${n(r * 0.9)},${n(-r * 0.75)}`, fill: 'stroke' };
    case 'cross':
      return { d: `M${n(-r * 0.7)},${n(-r * 0.7)}L${n(r * 0.7)},${n(r * 0.7)}M${n(r * 0.7)},${n(-r * 0.7)}L${n(-r * 0.7)},${n(r * 0.7)}`, fill: 'stroke' };
    case 'star': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const k = i % 2 === 0 ? r * 1.25 : r * 0.55;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push([k * Math.cos(a), k * Math.sin(a)]);
      }
      return { d: poly(pts), fill: 'solid' };
    }
    case 'half':
      return { d: circle(r * 0.85), fill: 'hollow', inner: `M0,${n(-r * 0.85)}A${n(r * 0.85)},${n(r * 0.85)} 0 0 0 0,${n(r * 0.85)}Z` };
    case 'target':
      return { d: circle(r * 0.9), fill: 'hollow', inner: circle(r * 0.4) };
    case 'rewind': {
      // An open circle turning clockwise, with its arrowhead at the top.
      const k = r * 0.75;
      const a0 = -Math.PI / 2 + 0.5;
      const a1 = -Math.PI / 2 - 0.2;
      const [x0, y0] = [k * Math.cos(a0), k * Math.sin(a0)];
      const [x1, y1] = [k * Math.cos(a1), k * Math.sin(a1)];
      return {
        d: `M${n(x0)},${n(y0)}A${n(k)},${n(k)} 0 1 1 ${n(x1)},${n(y1)}M${n(x1 - r * 0.45)},${n(y1 - r * 0.35)}L${n(x1)},${n(y1)}L${n(x1 - r * 0.2)},${n(y1 + r * 0.5)}`,
        fill: 'stroke',
      };
    }
    case 'arrow':
      return { d: poly([[-r * 0.7, -r], [r, 0], [-r * 0.7, r]]), fill: 'solid' };
  }
}
