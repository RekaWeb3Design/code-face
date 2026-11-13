#!/usr/bin/env node
// Release check: run before every deploy and push (npm run release-check). Fails (exit code 1) if the
// tracked tree contains anything that must never be published:
//   1. an image outside the allowlist (README screenshots, og image, poster preview, favicon);
//   2. an SVG poster, or a Code Face code file (code-face*.txt, stage-*.txt or any file that starts with
//      "CODE FACE <version>") outside the landing's stage folder public/demo/;
//   3. anything from test-images/ or .playwright-mcp/;
//   4. the two banned strings in BANNED below (a messaging app's name, any case, and a location tag) in any text file;
//   5. the contact e-mail address anywhere except the README "Made by" line and the landing footer;
//   6. a committed JPEG, PNG or WebP that still carries EXIF (or XMP) metadata.
// It also fails if public/ has untracked or modified files: they would be deployed without being committed.
//
// The banned strings are put together from pieces so that this file does not trip its own check.
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {basename, extname} from 'node:path'

const BANNED = [
  {label: 'Whats' + 'App', test: (s) => /whats\s?app/i.test(s)},
  {label: 'G' + 'PS', test: (s) => s.includes('G' + 'PS')},
]
const EMAIL = ['hello', 'rekavig.com'].join('@')
// Where the e-mail address may appear: a file and a test for the line.
const EMAIL_ALLOWED = [
  {file: 'README.md', line: (l) => l.startsWith('Made by ')},
  {file: 'index.html', line: (l) => l.includes('class="foot-note"') && l.includes('Made by ')},
]

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif', '.ico', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.jxl'])
const IMAGE_ALLOWLIST = [
  /^docs\/screenshot-[a-z0-9-]+\.(webp|png|jpg)$/, // README screenshots
  /^public\/og-image\.jpg$/, // og:image
  /^public\/poster\/demo-poster-[a-z0-9-]+\.webp$/, // poster preview and its detail
  /^public\/favicon\.svg$/, // favicon
]
const STAGE_FOLDER = 'public/demo/'

const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
const files = git('ls-files', '-z').split('\0').filter(Boolean)
const failures = []
const fail = (rule, message) => failures.push(`${rule}: ${message}`)

const isBinary = (buf) => buf.subarray(0, 8000).includes(0)

// ---- metadata readers --------------------------------------------------------------------------
function jpegMetadata(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return ['not a JPEG']
  const found = []
  let i = 2
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break
    const marker = buf[i + 1]
    if (marker === 0xd9 || marker === 0xda) break // end of image / start of scan: no more metadata segments
    const length = buf.readUInt16BE(i + 2)
    const body = buf.subarray(i + 4, i + 2 + length)
    if (marker === 0xe1 && body.subarray(0, 6).toString('latin1') === 'Exif\0\0') found.push('EXIF (APP1)')
    if (marker === 0xe1 && body.toString('latin1').startsWith('http://ns.adobe.com/xap/1.0/')) found.push('XMP (APP1)')
    i += 2 + length
  }
  return found
}

function pngMetadata(buf) {
  if (buf.subarray(0, 8).toString('latin1') !== '\x89PNG\r\n\x1a\n') return ['not a PNG']
  const found = []
  let i = 8
  while (i + 8 <= buf.length) {
    const length = buf.readUInt32BE(i)
    const type = buf.subarray(i + 4, i + 8).toString('latin1')
    const data = buf.subarray(i + 8, i + 8 + length)
    if (type === 'eXIf') found.push('EXIF (eXIf chunk)')
    if (['tEXt', 'zTXt', 'iTXt'].includes(type)) {
      const keyword = data.subarray(0, Math.max(0, data.indexOf(0))).toString('latin1')
      if (/exif|xmp/i.test(keyword)) found.push(`${keyword} (${type} chunk)`)
    }
    if (type === 'IEND') break
    i += 12 + length
  }
  return found
}

function webpMetadata(buf) {
  if (buf.subarray(0, 4).toString('latin1') !== 'RIFF' || buf.subarray(8, 12).toString('latin1') !== 'WEBP') return ['not a WebP']
  const found = []
  let i = 12
  while (i + 8 <= buf.length) {
    const type = buf.subarray(i, i + 4).toString('latin1')
    const length = buf.readUInt32LE(i + 4)
    if (type === 'EXIF') found.push('EXIF chunk')
    if (type === 'XMP ') found.push('XMP chunk')
    i += 8 + length + (length % 2)
  }
  return found
}

// ---- the checks ----------------------------------------------------------------------------------
for (const file of files) {
  const ext = extname(file).toLowerCase()
  const name = basename(file)

  // 3. Private folders.
  if (file.startsWith('test-images/') || file.startsWith('.playwright-mcp/')) fail('private folder', file)

  // 1. Images only from the allowlist.
  if (IMAGE_EXT.has(ext) && !IMAGE_ALLOWLIST.some((pattern) => pattern.test(file))) fail('image not on the allowlist', file)

  // 2. SVG posters and code files.
  if (ext === '.svg' && !/^public\/favicon\.svg$/.test(file)) fail('SVG (possible poster)', file)
  const inStageFolder = file.startsWith(STAGE_FOLDER)
  const codeFileName = /^code-face.*\.txt$/i.test(name) || /^stage-\d+\.txt$/i.test(name)
  if (codeFileName && !inStageFolder) fail('code file outside public/demo/', file)

  let buf
  try {
    buf = readFileSync(file)
  } catch {
    continue // deleted in the working tree; git still lists it until the deletion is staged
  }

  // 6. Metadata in committed images.
  const meta = ['.jpg', '.jpeg'].includes(ext) ? jpegMetadata(buf) : ext === '.png' ? pngMetadata(buf) : ext === '.webp' ? webpMetadata(buf) : []
  if (meta.length > 0) fail('image metadata', `${file}: ${meta.join(', ')}`)

  if (isBinary(buf)) continue
  const text = buf.toString('utf8')

  if (text.startsWith('CODE FACE ') && !inStageFolder && !codeFileName) fail('code file outside public/demo/', file)

  // 4. Banned strings.
  for (const banned of BANNED) {
    text.split(/\r?\n/).forEach((line, k) => {
      if (banned.test(line)) fail(`string "${banned.label}"`, `${file}:${k + 1}`)
    })
  }

  // 5. The contact address only where it is meant to be.
  if (text.includes(EMAIL)) {
    text.split(/\r?\n/).forEach((line, k) => {
      if (!line.includes(EMAIL)) return
      const allowed = EMAIL_ALLOWED.some((a) => a.file === file && a.line(line))
      if (!allowed) fail('contact e-mail outside the allowed lines', `${file}:${k + 1}`)
    })
  }
}

// Files that would be deployed but are not committed.
const publicStatus = git('status', '--porcelain', '--untracked-files=all', '--', 'public').trim()
if (publicStatus) for (const line of publicStatus.split('\n')) fail('public/ not committed', line.trim())

const images = files.filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
console.log(`release-check: ${files.length} tracked files, ${images.length} images`)
for (const image of images) console.log(`  image ${image}`)
if (failures.length > 0) {
  console.log(`\nFAILED (${failures.length}):`)
  for (const failure of failures) console.log(`  ✗ ${failure}`)
  process.exit(1)
}
console.log('OK: allowlisted images only, no metadata, no private files or strings, e-mail only where allowed.')
