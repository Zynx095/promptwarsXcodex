// Self-contained QR Code generator (ISO/IEC 18004, Model 2): byte mode, error correction level M,
// versions 1–6 (up to 106 bytes), fixed mask pattern 0. Zero dependencies. The structure follows the
// reference design by Project Nayuki (MIT): data codewords are split into blocks, Reed-Solomon ECC
// is appended per block, blocks are interleaved, then placed in a zig-zag with format bits.

/** Data codewords, ECC codewords per block and number of blocks for level M, indexed by version. */
const LEVEL_M: Record<number, { totalCodewords: number; eccPerBlock: number; blocks: number }> = {
  1: { totalCodewords: 26, eccPerBlock: 10, blocks: 1 },
  2: { totalCodewords: 44, eccPerBlock: 16, blocks: 1 },
  3: { totalCodewords: 70, eccPerBlock: 26, blocks: 1 },
  4: { totalCodewords: 100, eccPerBlock: 18, blocks: 2 },
  5: { totalCodewords: 134, eccPerBlock: 24, blocks: 2 },
  6: { totalCodewords: 172, eccPerBlock: 16, blocks: 4 },
};
const ALIGNMENT: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };
const MAX_VERSION = 6;
const MASK = 0;

export class QrCapacityError extends Error {}

function dataCapacityBytes(version: number): number {
  const v = LEVEL_M[version]!;
  const dataCodewords = v.totalCodewords - v.eccPerBlock * v.blocks;
  return Math.floor((dataCodewords * 8 - 4 - 8) / 8); // mode indicator + 8-bit count
}

// ---- GF(256) arithmetic with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1 ----
function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = result[i]! ^ gfMultiply(coef, factor);
    });
  }
  return result;
}

function encodeCodewords(bytes: Uint8Array, version: number): number[] {
  const { totalCodewords, eccPerBlock, blocks } = LEVEL_M[version]!;
  const dataCodewords = totalCodewords - eccPerBlock * blocks;

  const bits: number[] = [];
  const push = (value: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, dataCodewords * 8 - bits.length)); // terminator
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < dataCodewords * 8; pad ^= 0xec ^ 0x11) push(pad, 8);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));

  // Split into blocks (short blocks first), append ECC, interleave
  const numShort = blocks - (totalCodewords % blocks);
  const shortLen = Math.floor(totalCodewords / blocks);
  const divisor = rsDivisor(eccPerBlock);
  const blockList: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dataLen = shortLen - eccPerBlock + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + dataLen);
    k += dataLen;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0); // placeholder so all blocks align during interleaving
    blockList.push([...dat, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < blockList[0]!.length; i++) {
    blockList.forEach((block, j) => {
      if (i !== shortLen - eccPerBlock || j >= numShort) result.push(block[i]!);
    });
  }
  return result;
}

/** Builds the module matrix (true = dark) for `text`, choosing the smallest version that fits. */
export function createQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= MAX_VERSION && bytes.length > dataCapacityBytes(version)) version++;
  if (version > MAX_VERSION) throw new QrCapacityError(`Text is too long for a version ${MAX_VERSION} QR code (${bytes.length} bytes).`);

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setFn = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    isFunction[y]![x] = true;
  };

  // Timing patterns
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  // Finder patterns with separators
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  // Alignment patterns (skipping those overlapping finders)
  const align = ALIGNMENT[version]!;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFn(align[i]! + dx, align[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  // Format bits: level M (00) + mask, BCH(15,5), XOR mask 0x5412
  const formatData = (0b00 << 3) | MASK;
  let rem = formatData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const format = ((formatData << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((format >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
  setFn(8, 7, bit(6));
  setFn(8, 8, bit(7));
  setFn(7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
  setFn(8, size - 8, true); // dark module

  // Data placement in the zig-zag order, then mask 0 ((x + y) % 2 === 0) on non-function modules
  const codewords = encodeCodewords(bytes, version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y]![x] && i < codewords.length * 8) {
          modules[y]![x] = ((codewords[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
        if (!isFunction[y]![x] && (x + y) % 2 === 0) modules[y]![x] = !modules[y]![x];
      }
    }
  }
  return modules;
}

/** Renders `text` as an SVG QR code with a 4-module quiet zone. */
export function generateQrSvg(text: string, size = 200): string {
  const matrix = createQrMatrix(text);
  const quiet = 4;
  const n = matrix.length + quiet * 2;
  let path = '';
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code"><rect width="${n}" height="${n}" fill="#ffffff"/><path d="${path}" fill="#2d0b29"/></svg>`;
}
