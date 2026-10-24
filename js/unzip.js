'use strict';
/*
 * Lettore ZIP minimale, senza librerie esterne.
 * Legge la "central directory" dell'archivio e decomprime i file con
 * DecompressionStream('deflate-raw'), integrato nei browser moderni
 * (Chrome/Android 103+, Safari/iOS 16.4+).
 */

function listZip(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const td = new TextDecoder();

  // Cerca il record "End Of Central Directory" partendo dalla fine.
  let eocd = -1;
  const stop = Math.max(0, buf.byteLength - 65557);
  for (let i = buf.byteLength - 22; i >= stop; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Il file .zip non è valido o è danneggiato.');

  let count = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);

  // Archivi ZIP64 (molto grandi).
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
      const z64 = Number(dv.getBigUint64(loc + 8, true));
      count = Number(dv.getBigUint64(z64 + 32, true));
      cdOffset = Number(dv.getBigUint64(z64 + 48, true));
    }
  }

  const entries = [];
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    let csize = dv.getUint32(p + 20, true);
    let usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    let localOffset = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));

    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = dv.getUint16(e, true);
        const size = dv.getUint16(e + 2, true);
        if (id === 1) {
          let q = e + 4;
          if (usize === 0xffffffff) { usize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(dv.getBigUint64(q, true)); }
        }
        e += 4 + size;
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;

    entries.push({ name, method, csize, localOffset, buf });
  }
  return entries;
}

async function inflateEntry(entry) {
  const dv = new DataView(entry.buf);
  const lo = entry.localOffset;
  const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
  const data = new Uint8Array(entry.buf, start, entry.csize);

  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new Error('Formato di compressione non supportato in ' + entry.name);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Questo browser non sa aprire i file .zip. Estrai lo zip e importa direttamente i file .json.');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}
