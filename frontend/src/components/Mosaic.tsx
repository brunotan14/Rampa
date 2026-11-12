// Mosaico de azulejos da faixa da tela inicial (TelaInicial): decorativo, `aria-hidden`, nada
// depende dele. Os 16 azulejos entram girando de leve, em diagonal, uma vez só, e só sem
// preferência por movimento reduzido (o CSS cuida disso).
import type { CSSProperties } from "react";

const TILE = 64;
const COLORS = ["a5", "k", "a3", "c5", "a7", "a5", "k", "c3", "a3", "a5", "c5", "k", "a7", "a3", "k", "a5"] as const;
const SHAPES = ["q0", "sq", "q1", "tri", "q2", "q3", "sq", "tri", "q1", "q0", "q3", "tri", "sq", "q2", "q0", "q1"] as const;

function tilePath(shape: (typeof SHAPES)[number], x: number, y: number): string {
  if (shape === "sq") return `M${x} ${y}h${TILE}v${TILE}h-${TILE}z`;
  if (shape === "tri") return `M${x} ${y + TILE}H${x + TILE}V${y}Z`;
  // Quarto de círculo com o centro num dos cantos do azulejo.
  const cx = shape === "q0" || shape === "q3" ? x : x + TILE;
  const cy = shape === "q0" || shape === "q1" ? y : y + TILE;
  const ex = cx === x ? x + TILE : x;
  const ey = cy === y ? y + TILE : y;
  const sweep = shape === "q0" || shape === "q2" ? 1 : 0;
  return `M${cx} ${cy}L${ex} ${cy}A${TILE} ${TILE} 0 0 ${sweep} ${cx} ${ey}Z`;
}

const TILES = SHAPES.map((shape, i) => {
  const row = Math.floor(i / 4);
  const col = i % 4;
  return { d: tilePath(shape, col * TILE, row * TILE), color: COLORS[i], order: (row + col) * 2 + (i % 3) };
});

export function Mosaic() {
  return (
    <svg className="rp-mosaic" viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <rect className="rp-mosaic__bg" width="256" height="256" />
      {TILES.map((tile, i) => (
        <path key={i} className={`rp-mosaic__tile rp-mosaic__tile--${tile.color}`} d={tile.d} style={{ "--i": tile.order } as CSSProperties} />
      ))}
    </svg>
  );
}
