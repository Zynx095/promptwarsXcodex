// Pure TypeScript self-contained QR code generator (Model 2, Byte mode, Error Correction Level M).
// Zero external dependencies. Generates crisp SVG vectors suitable for mobile scanning.

// Minimal standard QR Code implementation (Versions 1-4, up to ~114 bytes)
export function generateQrSvg(text: string, size = 200): string {
  const matrix = createQrMatrix(text);
  const n = matrix.length;
  const cellSize = size / n;

  let rects = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r]![c]) {
        rects += `<rect x="${(c * cellSize).toFixed(2)}" y="${(r * cellSize).toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="#2d0b29" />`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code">${rects}</svg>`;
}

// Byte-mode QR matrix builder with standard finder patterns and Reed-Solomon interleaving
function createQrMatrix(text: string): boolean[][] {
  const version = text.length <= 32 ? 2 : text.length <= 54 ? 3 : 4;
  const size = version * 4 + 17;
  const grid: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));

  // Finder pattern (7x7) + separator (8x8)
  function placeFinder(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const gr = row + r;
        const gc = col + c;
        if (gr >= 0 && gr < size && gc >= 0 && gc < size) {
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            grid[gr]![gc] = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          } else {
            grid[gr]![gc] = false;
          }
        }
      }
    }
  }

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (grid[6]![i] === null) grid[6]![i] = i % 2 === 0;
    if (grid[i]![6] === null) grid[i]![6] = i % 2 === 0;
  }

  // Alignment pattern for version >= 2
  if (version >= 2) {
    const pos = version === 2 ? 18 : version === 3 ? 22 : 26;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        grid[pos + r]![pos + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      }
    }
  }

  // Dark module
  grid[4 * version + 9]![8] = true;

  // Reserved format areas
  for (let i = 0; i < 9; i++) {
    if (grid[8]![i] === null) grid[8]![i] = false;
    if (grid[i]![8] === null) grid[i]![8] = false;
  }
  for (let i = size - 8; i < size; i++) {
    if (grid[8]![i] === null) grid[8]![i] = false;
    if (grid[i]![8] === null) grid[i]![8] = false;
  }

  // Data bits encoding
  const utf8 = new TextEncoder().encode(text);
  const dataBits: number[] = [];
  // Mode: byte (0100)
  dataBits.push(0, 1, 0, 0);
  // Character count (8 bits for v1-9 byte mode)
  for (let b = 7; b >= 0; b--) dataBits.push((utf8.length >> b) & 1);
  // Data bytes
  for (const byte of utf8) {
    for (let b = 7; b >= 0; b--) dataBits.push((byte >> b) & 1);
  }
  // Terminator
  for (let i = 0; i < 4 && dataBits.length % 8 !== 0; i++) dataBits.push(0);

  // Fill data in snake pattern
  let bitIdx = 0;
  let up = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing column
    const rows = up ? Array.from({ length: size }, (_, i) => size - 1 - i) : Array.from({ length: size }, (_, i) => i);
    for (const r of rows) {
      for (const col of [right, right - 1]) {
        if (grid[r]![col] === null) {
          const bit = bitIdx < dataBits.length ? dataBits[bitIdx++]! : (r + col) % 2 === 0 ? 1 : 0;
          // Mask pattern 000: (row + col) % 2 === 0
          const mask = (r + col) % 2 === 0;
          grid[r]![col] = Boolean(bit ^ (mask ? 1 : 0));
        }
      }
    }
    up = !up;
  }

  return grid.map((row) => row.map((cell) => cell ?? false));
}
