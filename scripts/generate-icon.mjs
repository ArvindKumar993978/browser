import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { deflateSync } from 'zlib'

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function renderOrbitPng(size) {
  const raw = Buffer.alloc(size * (1 + size * 4))
  const cx = (size - 1) / 2
  const cy = (size - 1) / 2
  const radius = size * 0.44

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4)
    raw[rowStart] = 0 // filter none
    for (let x = 0; x < size; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist = Math.hypot(dx, dy)

      let r = 15
      let g = 18
      let b = 28
      let a = 0

      // Smooth outer circle background
      if (dist <= radius + 1.2) {
        const edgeAlpha = Math.min(1, Math.max(0, radius + 1.2 - dist))
        a = Math.round(edgeAlpha * 255)

        // Subtle gradient inside badge
        const grad = (x + y) / (size * 2)
        r = Math.round(14 + grad * 12)
        g = Math.round(18 + grad * 18)
        b = Math.round(30 + grad * 28)

        // Outer sky ring border
        const borderDist = Math.abs(dist - radius * 0.92)
        if (borderDist < size * 0.035) {
          const t = 1 - borderDist / (size * 0.035)
          r = Math.round(r * (1 - t) + 56 * t)
          g = Math.round(g * (1 - t) + 189 * t)
          b = Math.round(b * (1 - t) + 248 * t)
        }

        // Tilted orbital ellipse
        const angle = -0.52
        const rx = dx * Math.cos(angle) - dy * Math.sin(angle)
        const ry = dx * Math.sin(angle) + dy * Math.cos(angle)
        const ellipse = Math.hypot(rx / (size * 0.34), ry / (size * 0.14))
        const orbitDist = Math.abs(ellipse - 1) * size * 0.14
        if (orbitDist < size * 0.032) {
          const t = 1 - orbitDist / (size * 0.032)
          r = Math.round(r * (1 - t) + 125 * t)
          g = Math.round(g * (1 - t) + 211 * t)
          b = Math.round(b * (1 - t) + 252 * t)
        }

        // Center planet core
        if (dist <= size * 0.15) {
          const coreShade = 1 - dist / (size * 0.15)
          r = Math.round(14 + coreShade * 42)
          g = Math.round(165 + coreShade * 55)
          b = Math.round(233 + coreShade * 22)
        }

        // Orbiting satellite dot
        const satX = cx + Math.cos(0.45) * size * 0.27
        const satY = cy - Math.sin(0.45) * size * 0.18
        const satDist = Math.hypot(x - satX, y - satY)
        if (satDist <= size * 0.055) {
          r = 255
          g = 255
          b = 255
        }
      }

      const px = rowStart + 1 + x * 4
      raw[px] = r
      raw[px + 1] = g
      raw[px + 2] = b
      raw[px + 3] = a
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function buildIco(pngEntries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // ICO type
  header.writeUInt16LE(pngEntries.length, 4)

  const dirEntries = []
  let offset = 6 + pngEntries.length * 16

  for (const { size, png } of pngEntries) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    dirEntries.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...dirEntries, ...pngEntries.map((e) => e.png)])
}

const buildDir = join(process.cwd(), 'build')
mkdirSync(buildDir, { recursive: true })

const sizes = [256, 48, 32, 16]
const entries = sizes.map((size) => ({ size, png: renderOrbitPng(size) }))

writeFileSync(join(buildDir, 'icon.png'), entries[0].png)
writeFileSync(join(buildDir, 'icon.ico'), buildIco(entries))
console.log('Generated build/icon.png and build/icon.ico')
