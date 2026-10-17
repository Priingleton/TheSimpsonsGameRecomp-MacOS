'use strict';

/**
 * EA RefPack (LZSS) codec used by SAGE .str chunks.
 * Decompress + compress match the Python reference (byte-identical body).
 */

const MAGIC_SECOND = 0xfb;
const MAX_WINDOW = 131072;
const MAX_MATCH = 1028;

class RefpackError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RefpackError';
  }
}

function copyRef(out, di, distance, length) {
  if (distance > di) {
    throw new RefpackError(
      `RefPack back-reference reaches before start (distance ${distance} at ${di})`
    );
  }
  let ref = di - distance;
  if (distance >= length) {
    out.set(out.subarray(ref, ref + length), di);
    return di + length;
  }
  let remaining = length;
  while (remaining > 0) {
    const chunk = Math.min(distance, remaining);
    out.set(out.subarray(ref, ref + chunk), di);
    di += chunk;
    ref += chunk;
    remaining -= chunk;
  }
  return di;
}

function decompress(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 6) {
    throw new RefpackError(`RefPack stream too short: ${buf.length} bytes`);
  }
  if (buf[1] !== MAGIC_SECOND) {
    throw new RefpackError(`not a RefPack stream: bad magic ${buf.subarray(0, 2).toString('hex')}`);
  }
  const flags = (buf[0] << 8) | buf[1];
  const sizeWidth = flags & 0x8000 ? 4 : 3;
  let pos = 2;
  if (flags & 0x0100) {
    pos += sizeWidth;
  }
  if (pos + sizeWidth > buf.length) {
    throw new RefpackError('RefPack stream too short for size field');
  }
  let unpackedSize = 0;
  for (let i = 0; i < sizeWidth; i++) {
    unpackedSize = (unpackedSize << 8) | buf[pos + i];
  }
  pos += sizeWidth;

  const out = Buffer.allocUnsafe(unpackedSize);
  let di = 0;
  const n = buf.length;
  while (true) {
    if (pos >= n) {
      throw new RefpackError('RefPack stream ends mid-command');
    }
    const first = buf[pos++];
    if (!(first & 0x80)) {
      if (pos >= n) throw new RefpackError('RefPack stream ends mid-command');
      const second = buf[pos++];
      const run = first & 3;
      out.set(buf.subarray(pos, pos + run), di);
      di += run;
      pos += run;
      const distance = ((first & 0x60) << 3) + second + 1;
      const length = ((first & 0x1c) >> 2) + 3;
      di = copyRef(out, di, distance, length);
      continue;
    }
    if (!(first & 0x40)) {
      if (pos + 1 >= n) throw new RefpackError('RefPack stream ends mid-command');
      const second = buf[pos++];
      const third = buf[pos++];
      const run = second >> 6;
      out.set(buf.subarray(pos, pos + run), di);
      di += run;
      pos += run;
      const distance = ((second & 0x3f) << 8) + third + 1;
      const length = (first & 0x3f) + 4;
      di = copyRef(out, di, distance, length);
      continue;
    }
    if (!(first & 0x20)) {
      if (pos + 2 >= n) throw new RefpackError('RefPack stream ends mid-command');
      const second = buf[pos++];
      const third = buf[pos++];
      const fourth = buf[pos++];
      const run = first & 3;
      out.set(buf.subarray(pos, pos + run), di);
      di += run;
      pos += run;
      const distance = (((first & 0x10) >> 4) << 16) + (second << 8) + third + 1;
      const length = (((first & 0x0c) >> 2) << 8) + fourth + 5;
      di = copyRef(out, di, distance, length);
      continue;
    }
    let run = ((first & 0x1f) << 2) + 4;
    if (run <= 112) {
      out.set(buf.subarray(pos, pos + run), di);
      di += run;
      pos += run;
      continue;
    }
    run = first & 3;
    out.set(buf.subarray(pos, pos + run), di);
    di += run;
    pos += run;
    break;
  }
  if (di !== unpackedSize) {
    throw new RefpackError(`RefPack decoded ${di} bytes, expected ${unpackedSize}`);
  }
  return out;
}

function matchLen(data, s, d, maxmatch, lo) {
  lo = Math.min(lo, maxmatch);
  let hi = maxmatch;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    let ok = true;
    for (let i = 0; i < mid; i++) {
      if (data[s + i] !== data[d + i]) {
        ok = false;
        break;
      }
    }
    if (ok) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function compressBody(data) {
  const n = data.length;
  const out = [];
  const hashtbl = new Int32Array(65536).fill(-1);
  const link = new Int32Array(MAX_WINDOW).fill(-1);
  const MASK = MAX_WINDOW - 1;

  const hashes = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const a = data[i];
    const b = i + 1 < n ? data[i + 1] : 0;
    const c = i + 2 < n ? data[i + 2] : 0;
    hashes[i] = ((a << 8) ^ (b << 4) ^ c) & 0xffff;
  }

  let run = 0;
  let cptr = 0;
  let rptr = 0;
  let remaining = n;

  while (remaining > 0) {
    let boffset = 0;
    let blen = 2;
    let bcost = 2;
    const mlen = Math.min(remaining - 4, MAX_MATCH);

    const hash = hashes[cptr];
    let hoffset = hashtbl[hash];
    const minhoffset = Math.max(cptr - (MAX_WINDOW - 1), 0);

    if (hoffset >= minhoffset) {
      let ci = cptr + blen;
      while (true) {
        const tptr = hoffset;
        if (
          ci < n &&
          data[ci] === data[tptr + blen] &&
          Buffer.compare(data.subarray(cptr, ci), data.subarray(tptr, tptr + blen)) === 0
        ) {
          const tlen = matchLen(data, cptr, tptr, mlen, blen + 1);
          if (tlen > blen) {
            const toffset = cptr - 1 - tptr;
            let tcost;
            if (toffset < 1024 && tlen <= 10) tcost = 2;
            else if (toffset < 16384 && tlen <= 67) tcost = 3;
            else tcost = 4;
            if (tlen - tcost > blen - bcost) {
              blen = tlen;
              bcost = tcost;
              boffset = toffset;
              ci = cptr + blen;
              if (blen >= mlen) break;
            }
          }
        }
        hoffset = link[hoffset & MASK];
        if (hoffset < minhoffset) break;
      }
    }

    if (bcost >= blen) {
      link[cptr & MASK] = hashtbl[hash];
      hashtbl[hash] = cptr;
      run += 1;
      cptr += 1;
      remaining -= 1;
      continue;
    }

    while (run > 3) {
      const tlen = Math.min(112, run & ~3);
      run -= tlen;
      out.push(0xe0 + (tlen >> 2) - 1);
      for (let i = 0; i < tlen; i++) out.push(data[rptr + i]);
      rptr += tlen;
    }

    if (bcost === 2) {
      out.push(((boffset >> 8) << 5) + ((blen - 3) << 2) + run);
      out.push(boffset & 0xff);
    } else if (bcost === 3) {
      out.push(0x80 + (blen - 4));
      out.push(((run << 6) + (boffset >> 8)) & 0xff);
      out.push(boffset & 0xff);
    } else {
      out.push(0xc0 + ((boffset >> 16) << 4) + (((blen - 5) >> 8) << 2) + run);
      out.push((boffset >> 8) & 0xff);
      out.push(boffset & 0xff);
      out.push((blen - 5) & 0xff);
    }

    if (run) {
      for (let i = 0; i < run; i++) out.push(data[rptr + i]);
      run = 0;
    }

    for (let i = cptr; i < cptr + blen; i++) {
      const h = hashes[i];
      link[i & MASK] = hashtbl[h];
      hashtbl[h] = i;
    }
    cptr += blen;
    rptr = cptr;
    remaining -= blen;
  }

  while (run > 3) {
    const tlen = Math.min(112, run & ~3);
    run -= tlen;
    out.push(0xe0 + (tlen >> 2) - 1);
    for (let i = 0; i < tlen; i++) out.push(data[rptr + i]);
    rptr += tlen;
  }

  out.push(0xfc + run);
  for (let i = 0; i < run; i++) out.push(data[rptr + i]);

  return Buffer.from(out);
}

function compress(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const size = buf.length;
  if (size > 0xffffff) {
    throw new RefpackError(`input too large for 3-byte RefPack size: ${size}`);
  }
  const header = Buffer.from([0x10, 0xfb, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff]);
  return Buffer.concat([header, compressBody(buf)]);
}

module.exports = { compress, decompress, RefpackError };
