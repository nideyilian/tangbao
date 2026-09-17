import http from 'node:http'
import zlib from 'node:zlib'

const port = Number(process.env.MOCK_IMAGE_API_PORT || 8787)
const host = process.env.MOCK_IMAGE_API_HOST || '127.0.0.1'
const defaultMode = process.env.MOCK_IMAGE_API_MODE || 'url-cors-block'

/**
 * 样图尺寸与变体数。
 *
 * 这里刻意生成真实尺寸、带内容的 PNG（而不是 1×1 透明像素）：
 * 后处理链路里的缩放、水印合成、体积压缩（maxSizeKb）、命名模板都只有在
 * 源图尺寸/体积足够真实时才看得出结果。1×1 图能让链路「不报错」，
 * 但看不出任何效果，也无法验证 PNG→JPEG 的降级分支。
 * 用 MOCK_IMAGE_API_SAMPLE_SIZE 可以调小加速（例如 256）。
 */
const SAMPLE_SIZE = Math.max(8, Math.floor(Number(process.env.MOCK_IMAGE_API_SAMPLE_SIZE) || 1024))
const SAMPLE_VARIANTS = 4

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

function clamp8(value) {
  if (value < 0) return 0
  if (value > 255) return 255
  return value
}

/** HSV(h: 0-360, s/v: 0-1) → RGB(0-255)，用于让每个变体有可区分的色相 */
function hsvToRgb(h, s, v) {
  const c = v * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = v - c
  const table = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ]
  const [r, g, b] = table[Math.floor(hp) % 6]
  return [clamp8((r + m) * 255), clamp8((g + m) * 255), clamp8((b + m) * 255)]
}

/**
 * 单像素取样。图案分四层，各层对应一个待验证的能力：
 * 渐变底 → 缩放/压缩后仍可辨认；64px 网格 → 缩放比例是否生效；
 * 中心靶心 → 水印与合成图层的位置参照；角标 → 区分同批第几张。
 * 末尾叠轻微噪点，让 PNG 体积接近真实照片，体积压缩分支才有意义。
 */
function samplePixel(x, y, variant) {
  const size = SAMPLE_SIZE
  const u = x / (size - 1)
  const v = y / (size - 1)
  const [br, bg, bb] = hsvToRgb(variant * 90 + u * 60, 0.45 + v * 0.35, 0.98 - v * 0.3)
  let r = br
  let g = bg
  let b = bb

  if (x % 64 === 0 || y % 64 === 0) {
    r = 250
    g = 250
    b = 250
  }

  const cx = size / 2
  const cy = size / 2
  const d = Math.hypot(x - cx, y - cy)
  if (d < size * 0.22) {
    r = 28
    g = 28
    b = 32
  } else if (d < size * 0.26) {
    r = 250
    g = 250
    b = 250
  }
  if (d < size * 0.08) {
    const accent = hsvToRgb(variant * 90 + 180, 0.75, 0.95)
    r = accent[0]
    g = accent[1]
    b = accent[2]
  }

  const mark = Math.floor(size * 0.12)
  const inCorner = (x < mark && y < mark) || (x >= size - mark && y >= size - mark) || (x < mark && y >= size - mark)
  if (inCorner && (x + y) % 24 < 12) {
    const tag = hsvToRgb((variant * 90) % 360, 0.85, 0.9)
    r = tag[0]
    g = tag[1]
    b = tag[2]
  }

  const noise = (((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 17) - 8
  return [clamp8(r + noise), clamp8(g + noise), clamp8(b + noise)]
}

function createSamplePng(variant) {
  const size = SAMPLE_SIZE
  const raw = Buffer.allocUnsafe((size * 3 + 1) * size)
  let offset = 0
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0 // filter: None
    offset += 1
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = samplePixel(x, y, variant)
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      offset += 3
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

const samplePngByVariant = Array.from({ length: SAMPLE_VARIANTS }, (_, index) => createSamplePng(index))
const sampleBase64ByVariant = samplePngByVariant.map(() => null)

function pickVariant(index) {
  const value = Number(index)
  if (!Number.isFinite(value)) return 0
  return ((Math.trunc(value) % SAMPLE_VARIANTS) + SAMPLE_VARIANTS) % SAMPLE_VARIANTS
}

function samplePng(index = 0) {
  return samplePngByVariant[pickVariant(index)]
}

/** base64 体积大，按需生成并缓存，避免启动时白算 4 份 */
function samplePngBase64(index = 0) {
  const variant = pickVariant(index)
  if (!sampleBase64ByVariant[variant]) sampleBase64ByVariant[variant] = samplePngByVariant[variant].toString('base64')
  return sampleBase64ByVariant[variant]
}

const pathModes = new Set([
  'api-no-cors',
  'b64',
  'empty',
  'http-error',
  'invalid-json',
  'no-recognizable',
  'slow',
  'url-404',
  'url-cors-block',
  'url-ok',
  'url-redirect-cors-block',
  'wrong-shape',
])

function appendCors(headers, enabled = true) {
  if (!enabled) return headers
  return {
    ...headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
}

function send(res, status, headers, body) {
  res.writeHead(status, headers)
  res.end(body)
}

function sendJson(res, status, payload, options = {}) {
  const body = JSON.stringify(payload, null, options.pretty ? 2 : 0)
  send(res, status, appendCors({ 'Content-Type': 'application/json; charset=utf-8' }, options.cors !== false), body)
}

async function sendSse(res, events, options = {}) {
  res.writeHead(
    200,
    appendCors(
      {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      },
      options.cors !== false,
    ),
  )

  for (const event of events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  res.write('data: [DONE]\n\n')
  res.end()
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) {
        resolve({ text: '', json: null })
        return
      }
      try {
        resolve({ text, json: JSON.parse(text) })
      } catch {
        resolve({ text, json: null })
      }
    })
    req.on('error', () => resolve({ text: '', json: null }))
  })
}

function getMode(url, body) {
  const queryMode = url.searchParams.get('mode')
  if (queryMode) return queryMode

  const firstSegment = url.pathname.split('/').filter(Boolean)[0]
  if (pathModes.has(firstSegment)) return firstSegment

  if (body && typeof body === 'object') {
    if (typeof body.mode === 'string' && body.mode.trim()) return body.mode.trim()
    if (typeof body.model === 'string') {
      const match = body.model.match(/^mock:(.+)$/)
      if (match) return match[1]
    }
  }

  return defaultMode
}

function getRequestedN(url, body) {
  const raw = url.searchParams.get('n') ?? (body && typeof body === 'object' ? body.n : undefined)
  const n = Number(raw)
  return Number.isFinite(n) ? Math.max(1, Math.min(10, Math.floor(n))) : 1
}

function getBaseUrl(req) {
  return `http://${req.headers.host || `${host}:${port}`}`
}

function getImageUrl(req, cors, index = 0) {
  return `${getBaseUrl(req)}/images/mock.png?cors=${cors ? '1' : '0'}&i=${index}&t=${Date.now()}`
}

function createRandomShape(req, cors, index = 0) {
  return {
    status: 'success',
    data: {
      id: 42 + index,
      name: `example-${index + 1}.jpg`,
      url: getImageUrl(req, cors, index),
      width: SAMPLE_SIZE,
      height: SAMPLE_SIZE,
      mime: 'image/png',
    },
  }
}

function createOpenAIResponse(req, mode, n = 1) {
  const created = Math.floor(Date.now() / 1000)

  if (mode === 'b64') {
    return {
      created,
      data: Array.from({ length: n }, (_, i) => ({
        b64_json: samplePngBase64(i),
        revised_prompt: `mock b64 image ${i + 1}`,
      })),
    }
  }

  if (mode === 'empty') return { created, data: [] }
  if (mode === 'wrong-shape') return createRandomShape(req, false)
  if (mode === 'no-recognizable')
    return {
      created,
      data: Array.from({ length: n }, (_, i) => ({ id: 42 + i, name: `example-${i + 1}.jpg`, mime: 'image/png' })),
    }

  if (mode === 'url-404') {
    return {
      created,
      data: Array.from({ length: n }, (_, i) => ({ url: `${getBaseUrl(req)}/images/missing.png?cors=1&i=${i}` })),
    }
  }

  if (mode === 'url-redirect-cors-block') {
    return {
      created,
      data: Array.from({ length: n }, (_, i) => ({ url: `${getBaseUrl(req)}/images/redirect?cors=0&i=${i}` })),
    }
  }

  return {
    created,
    data: Array.from({ length: n }, (_, i) => ({
      url: getImageUrl(req, mode === 'url-ok', i),
      revised_prompt: `mock ${mode} ${i + 1}`,
    })),
  }
}

function isOpenAIImagesPath(pathname) {
  return pathname.endsWith('/v1/images/generations') || pathname.endsWith('/v1/images/edits')
}

function isOpenAIResponsesPath(pathname) {
  return pathname.endsWith('/v1/responses')
}

function isCustomPath(pathname) {
  return pathname === '/custom/random-image' || pathname === '/custom/generate'
}

function createImagesStreamEvents(req, mode, n, isEdit) {
  const created = Math.floor(Date.now() / 1000)
  const prefix = isEdit ? 'image_edit' : 'image_generation'
  const partialCount = mode === 'empty' ? 0 : 2
  const partials = Array.from({ length: partialCount }, (_, i) => ({
    type: `${prefix}.partial_image`,
    created_at: created,
    partial_image_index: i,
    b64_json: samplePngBase64(i),
    output_format: 'png',
    quality: 'auto',
    size: `${SAMPLE_SIZE}x${SAMPLE_SIZE}`,
  }))
  const completed = Array.from({ length: n }, (_, i) => ({
    type: `${prefix}.completed`,
    created_at: created,
    b64_json: samplePngBase64(partialCount + i),
    output_format: 'png',
    quality: 'auto',
    size: `${SAMPLE_SIZE}x${SAMPLE_SIZE}`,
  }))
  return [...partials, ...completed]
}

function createResponsesStreamEvents(mode) {
  const partials =
    mode === 'empty'
      ? []
      : [0, 1].map((index) => ({
          type: 'response.image_generation_call.partial_image',
          output_index: 0,
          item_id: 'mock-image-generation',
          partial_image_index: index,
          partial_image_b64: samplePngBase64(index),
        }))

  return [
    ...partials,
    {
      type: 'response.completed',
      response: {
        output:
          mode === 'empty'
            ? []
            : [
                {
                  type: 'image_generation_call',
                  status: 'completed',
                  revised_prompt: `mock ${mode} response image`,
                  result: samplePngBase64(2),
                  output_format: 'png',
                  quality: 'auto',
                  size: `${SAMPLE_SIZE}x${SAMPLE_SIZE}`,
                },
              ],
      },
    },
  ]
}

async function handleApi(req, res, url) {
  const body = req.method === 'GET' ? { json: null } : await readBody(req)
  const mode = getMode(url, body.json)
  const n = getRequestedN(url, body.json)

  if (mode === 'slow') {
    const delayMs = Math.max(1, Number(url.searchParams.get('delayMs') || 15000))
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  if (mode === 'api-no-cors') {
    sendJson(res, 200, createOpenAIResponse(req, 'url-ok', n), { cors: false })
    return
  }

  if (mode === 'http-error') {
    sendJson(res, 500, { error: { message: 'Mock HTTP failure from local test API' } })
    return
  }

  if (mode === 'invalid-json') {
    send(res, 200, appendCors({ 'Content-Type': 'application/json; charset=utf-8' }), '{ invalid json')
    return
  }

  const wantsStream =
    (body.json && typeof body.json === 'object' && body.json.stream === true) ||
    /name="stream"[\s\S]*?\r?\n\r?\ntrue/.test(body.text)
  if (wantsStream) {
    await sendSse(res, createImagesStreamEvents(req, mode, n, url.pathname.endsWith('/v1/images/edits')))
    return
  }

  sendJson(res, 200, createOpenAIResponse(req, mode, n))
}

async function handleResponses(req, res, url) {
  const body = req.method === 'GET' ? { json: null } : await readBody(req)
  const mode = getMode(url, body.json)

  if (body.json && typeof body.json === 'object' && body.json.stream === true) {
    await sendSse(res, createResponsesStreamEvents(mode))
    return
  }

  sendJson(res, 200, {
    output: createResponsesStreamEvents(mode).at(-1)?.response?.output ?? [],
  })
}

async function handleCustom(req, res, url) {
  const body = req.method === 'GET' ? { json: null } : await readBody(req)
  const mode = getMode(url, body.json)
  const n = getRequestedN(url, body.json)

  if (mode === 'http-error') {
    sendJson(res, 500, { error: { message: 'Mock custom provider failure' } })
    return
  }

  if (mode === 'empty' || mode === 'no-recognizable') {
    sendJson(res, 200, { status: 'success', data: { id: 42, name: 'example.jpg', mime: 'image/png' } })
    return
  }

  if (n > 1) {
    sendJson(res, 200, {
      status: 'success',
      data: {
        images: Array.from(
          { length: n },
          (_, i) => createRandomShape(req, mode === 'url-ok' || mode === 'b64', i).data,
        ),
      },
    })
    return
  }

  sendJson(res, 200, createRandomShape(req, mode === 'url-ok' || mode === 'b64'))
}

function handleImage(req, res, url) {
  const cors = url.searchParams.get('cors') === '1'

  if (url.pathname === '/images/redirect') {
    send(res, 302, appendCors({ Location: `/images/mock.png?cors=${cors ? '1' : '0'}` }, cors), '')
    return
  }

  if (url.pathname === '/images/missing.png') {
    send(res, 404, appendCors({ 'Content-Type': 'text/plain; charset=utf-8' }, cors), 'mock image missing')
    return
  }

  // 同一批里按 i 换色相，这样多图任务一眼能区分第几张
  const image = samplePng(url.searchParams.get('i'))
  const headers = appendCors(
    {
      'Cache-Control': 'no-store',
      'Content-Type': 'image/png',
      'Content-Length': String(image.length),
    },
    cors,
  )

  if (req.method === 'HEAD') {
    send(res, 200, headers, '')
    return
  }

  send(res, 200, headers, image)
}

function handleIndex(req, res) {
  sendJson(
    res,
    200,
    {
      name: 'tangbao mock image API',
      openaiCompatibleBaseUrls: [
        `${getBaseUrl(req)}/url-cors-block`,
        `${getBaseUrl(req)}/url-ok`,
        `${getBaseUrl(req)}/b64`,
        `${getBaseUrl(req)}/wrong-shape`,
        `${getBaseUrl(req)}/api-no-cors`,
      ],
      customEndpoint: `${getBaseUrl(req)}/custom/random-image`,
      modes: [...pathModes].sort(),
    },
    { pretty: true },
  )
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', getBaseUrl(req))
  const mode = getMode(url, null)
  const allowCors = mode !== 'api-no-cors' && !url.pathname.startsWith('/images/')

  if (req.method === 'OPTIONS') {
    send(res, 204, appendCors({}, allowCors), '')
    return
  }

  try {
    if (isOpenAIImagesPath(url.pathname)) {
      await handleApi(req, res, url)
      return
    }

    if (isOpenAIResponsesPath(url.pathname)) {
      await handleResponses(req, res, url)
      return
    }

    if (isCustomPath(url.pathname)) {
      await handleCustom(req, res, url)
      return
    }

    if (url.pathname.startsWith('/images/')) {
      handleImage(req, res, url)
      return
    }

    handleIndex(req, res)
  } catch (err) {
    sendJson(res, 500, { error: { message: err instanceof Error ? err.message : String(err) } })
  }
})

server.listen(port, host, () => {
  console.log(`Mock image API listening at http://${host}:${port}`)
  console.log(`OpenAI-compatible CORS image failure: http://${host}:${port}/url-cors-block`)
  console.log(`Custom non-OpenAI JSON endpoint: http://${host}:${port}/custom/random-image`)
})
