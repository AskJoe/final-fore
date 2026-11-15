import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const version = '26.8.3.1';
const release = '26.8';
const archiveName = `LibreOffice_${version}_Linux_x86-64_deb`;
const archiveUrl = `https://downloadarchive.documentfoundation.org/libreoffice/old/${version}/deb/x86_64/${archiveName}.tar.gz`;
const archiveSha256 = 'e7cd3538e85818ff9dd9bb65386769fde927011242aace5a144989f4000dcabf';
const officePackages = [
  `libobasis${release}-core`, `libobasis${release}-calc`, `libobasis${release}-en-us`,
  `libobasis${release}-ooofonts`, `libobasis${release}-graphicfilter`,
  `libreoffice${release}`, `libreoffice${release}-calc`, `libreoffice${release}-en-us`, `libreoffice${release}-ure`,
];
const debianPackages = [
  'libxinerama1', 'libx11-xcb1', 'libnss3', 'libnspr4', 'libdbus-1-3',
  'libcups2', 'libavahi-client3', 'libavahi-common3',
];
const output = fileURLToPath(new URL('../.render/', import.meta.url));

async function extractDebs(directory, destination) {
  for (const name of await readdir(directory)) {
    if (name.endsWith('.deb')) await execute('dpkg-deb', ['--extract', join(directory, name), destination]);
  }
}

async function install() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('The Render workbook preview requires an x86-64 Linux build host.');
  }
  console.log(`Preparing LibreOffice ${version} for the Render Node runtime.`);
  await mkdir(output, { recursive: true });
  const working = await mkdtemp(join(output, 'libreoffice-build-'));
  try {
    const archive = join(working, 'office.tar.gz');
    await execute('curl', ['--fail', '--silent', '--show-error', '--location', '--retry', '2', '--max-time', '180', '--output', archive, archiveUrl]);
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(archive)) digest.update(chunk);
    if (digest.digest('hex') !== archiveSha256) throw new Error('LibreOffice release checksum did not match.');

    await execute('tar', ['-xzf', archive, '-C', working,
      ...officePackages.map(name => `${archiveName}/DEBS/${name}_${version}-1_amd64.deb`),
    ]);
    const extractedDebs = join(working, archiveName, 'DEBS');
    const bundle = join(working, 'bundle');
    await mkdir(bundle);
    await extractDebs(extractedDebs, bundle);

    // APT verifies Debian's signed repositories. Use private directories and unpack the libraries as the build user.
    const apt = join(working, 'apt');
    const lists = join(apt, 'lists');
    const sources = join(apt, 'sources.list');
    await mkdir(lists, { recursive: true });
    await writeFile(sources, 'deb https://deb.debian.org/debian bookworm main\ndeb https://deb.debian.org/debian-security bookworm-security main\n');
    const aptOptions = [
      '-o', `Dir::Etc::sourcelist=${sources}`, '-o', 'Dir::Etc::sourceparts=-',
      '-o', `Dir::State::lists=${lists}`, '-o', `Dir::Cache=${apt}`,
    ];
    await execute('apt-get', [...aptOptions, 'update']);
    await execute('apt-get', [...aptOptions, 'download', ...debianPackages], { cwd: apt });
    await extractDebs(apt, bundle);

    const launcher = join(bundle, 'soffice');
    await writeFile(launcher, `#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export LD_LIBRARY_PATH="$root/lib/x86_64-linux-gnu:$root/usr/lib/x86_64-linux-gnu"
exec "$root/opt/libreoffice${release}/program/soffice" "$@"
`, { mode: 0o755 });

    const sample = join(working, 'preview-check.csv');
    await writeFile(sample, 'Market,Rate\nAustin,42\n');
    const result = await execute(launcher, [
      `-env:UserInstallation=${pathToFileURL(join(working, 'profile')).href}`, '--headless',
      '--convert-to', 'pdf:calc_pdf_Export', '--outdir', working, sample,
    ], { timeout: 20_000 });
    const pdf = await readFile(join(working, 'preview-check.pdf')).catch(() => null);
    if (pdf?.subarray(0, 5).toString() !== '%PDF-') {
      throw new Error(`LibreOffice did not generate a preview during the build. ${result.stderr.trim()}`);
    }
    const destination = join(output, 'libreoffice');
    await rm(destination, { recursive: true, force: true });
    await rename(bundle, destination);
    console.log('LibreOffice converted the build sample to PDF successfully.');
  } finally {
    await rm(working, { recursive: true, force: true });
  }
}

if (process.env.RENDER === 'true' && !process.env.FINAL_FORE_SOFFICE_PATH) {
  try {
    await install();
  } catch (error) {
    console.error(error.stderr || error.message);
    process.exitCode = 1;
  }
}
