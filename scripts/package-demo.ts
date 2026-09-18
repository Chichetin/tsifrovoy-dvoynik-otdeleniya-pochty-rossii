/**
 * E01: one ZIP of the submission — the two plans, the recommendation, its
 * effect and the instructions for opening them again.
 *
 * The archive is written by hand on `node:zlib` instead of pulling in a zip
 * library: adding a dependency belongs to the tooling owner, and the format we
 * need here is a handful of fixed-size headers. `readZip` is the same code
 * read backwards, which is what lets the tests unpack the real archive and
 * hand the extracted files to the browser — proof of "распаковал и открыл",
 * not of "должно открыться".
 *
 * Every field that could carry a clock is nailed down (fixed DOS timestamp, no
 * comments, no extra fields), so the same input always produces the same bytes.
 *
 * Run: npm run package:demo
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

/** Files of the submission set, in the order the README lists them. */
export const DEMO_FILES = [
  'README.md',
  'before.json',
  'after.json',
  'recommendation.json',
  'effect.md',
] as const;

/** Where the archive is written by default: a build artifact, not a source. */
export const DEFAULT_OUTPUT = 'build/demo/ops-digital-twin-demo.zip';

/** 2026-09-22 12:00 in DOS date/time: fixed, so the bytes are reproducible. */
const DOS_TIME = 12 << 11;
const DOS_DATE = ((2026 - 1980) << 9) | (9 << 5) | 22;
/** Bit 11: names are UTF-8. Every other flag stays off. */
const FLAG_UTF8 = 0x0800;
const METHOD_DEFLATE = 8;
const METHOD_STORE = 0;

export type ZipEntry = { name: string; bytes: number; packed: number };

export type PackageResult = {
  file: string;
  size: number;
  entries: ZipEntry[];
};

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/**
 * Standard CRC-32 (IEEE). Exported so a test can compare it with the published
 * check value: a checksum this file both writes and verifies would otherwise be
 * self-consistent and still wrong for every other unzip tool.
 */
export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Root of the repository. Resolved from this file when it runs as a script and
 * from the working directory under the test runner, whose module urls are not
 * file urls.
 */
function repoRoot(): string {
  // Not `new URL('..', import.meta.url)`: Vite treats that exact pattern as an
  // asset reference and rewrites it to an http url, so under the test runner it
  // stops being a path at all. A plain fileURLToPath is left alone.
  if (!import.meta.url.startsWith('file:')) return process.cwd();
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

type Prepared = {
  name: Buffer;
  method: number;
  crc: number;
  raw: number;
  packed: Buffer;
};

function prepare(name: string, content: Buffer): Prepared {
  const packed = deflateRawSync(content, { level: 9 });
  // A tiny file can come out larger compressed; storing it then is both
  // smaller and still a valid entry.
  const useDeflate = packed.length < content.length;
  return {
    name: Buffer.from(name, 'utf8'),
    method: useDeflate ? METHOD_DEFLATE : METHOD_STORE,
    crc: crc32(content),
    raw: content.length,
    packed: useDeflate ? packed : content,
  };
}

function localHeader(entry: Prepared): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(FLAG_UTF8, 6);
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.packed.length, 18);
  header.writeUInt32LE(entry.raw, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, entry.name]);
}

function centralHeader(entry: Prepared, offset: number): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(FLAG_UTF8, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.packed.length, 20);
  header.writeUInt32LE(entry.raw, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, entry.name]);
}

/** Builds the archive bytes from a name → content map. */
export function writeZip(files: Map<string, Buffer>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of files) {
    const entry = prepare(name, content);
    const header = localHeader(entry);
    parts.push(header, entry.packed);
    central.push(centralHeader(entry, offset));
    offset += header.length + entry.packed.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, directory, end]);
}

/**
 * Reads an archive written by `writeZip`. Deliberately strict: an unknown
 * compression method or a checksum that does not match is an error, because a
 * test that silently accepted a broken archive would prove nothing.
 */
export function readZip(archive: Buffer): Map<string, Buffer> {
  const endOffset = archive.lastIndexOf(
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  );
  if (endOffset < 0) throw new Error('Не ZIP: не найдена запись конца каталога');

  const count = archive.readUInt16LE(endOffset + 10);
  let cursor = archive.readUInt32LE(endOffset + 16);
  const files = new Map<string, Buffer>();

  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Повреждён центральный каталог на записи ${index}`);
    }
    const method = archive.readUInt16LE(cursor + 10);
    const crc = archive.readUInt32LE(cursor + 16);
    const packedSize = archive.readUInt32LE(cursor + 20);
    const rawSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const packed = archive.subarray(dataStart, dataStart + packedSize);

    let content: Buffer;
    if (method === METHOD_DEFLATE) content = inflateRawSync(packed);
    else if (method === METHOD_STORE) content = Buffer.from(packed);
    else throw new Error(`Файл «${name}»: неизвестный метод сжатия ${method}`);

    if (content.length !== rawSize) {
      throw new Error(`Файл «${name}»: размер ${content.length} вместо ${rawSize}`);
    }
    if (crc32(content) !== crc) throw new Error(`Файл «${name}»: не сошлась контрольная сумма`);

    files.set(name, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/** Collects the files of `demo/` as they are on disk. */
export function collectDemoFiles(sourceDir = join(repoRoot(), 'demo')): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const name of DEMO_FILES) files.set(name, readFileSync(join(sourceDir, name)));
  return files;
}

/** Writes the submission archive and reports what went into it. */
export function packageDemo(
  outputFile = join(repoRoot(), DEFAULT_OUTPUT),
  sourceDir = join(repoRoot(), 'demo'),
): PackageResult {
  const files = collectDemoFiles(sourceDir);
  const archive = writeZip(files);

  // The archive is unpacked right back and compared with what went in: a ZIP
  // nobody can read is worse than no ZIP at all.
  const check = readZip(archive);
  for (const [name, content] of files) {
    const extracted = check.get(name);
    if (extracted === undefined || !extracted.equals(content)) {
      throw new Error(`Файл «${name}» не распаковался обратно из архива`);
    }
  }

  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, archive);

  const entries: ZipEntry[] = [...files].map(([name, content]) => ({
    name,
    bytes: content.length,
    packed: prepare(name, content).packed.length,
  }));
  return { file: outputFile, size: archive.length, entries };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = packageDemo(process.argv[2]);
  const lines = result.entries.map(
    (entry) => `  ${entry.name}: ${entry.bytes} Б → ${entry.packed} Б`,
  );
  process.stdout.write(
    `Архив: ${result.file}\nРазмер: ${result.size} Б\nСостав:\n${lines.join('\n')}\n`,
  );
}
