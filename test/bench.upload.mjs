// 上传吞吐基准：直接向 /testOneFile 流式发送 300MB multipart 体（内存恒定，仅一个 256KB 缓冲）
// 用法：先启动 server.sample.mjs，再执行 node test/bench.upload.mjs
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const SIZE = 300 * 1024 * 1024
const CHUNK = 256 * 1024
const boundary = 'bench' + randomUUID()
const head = Buffer.from(
  `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bench.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
)
const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
const zero = Buffer.alloc(CHUNK)

const t0 = Date.now()
const req = http.request(
  {
    host: '127.0.0.1',
    port: 3333,
    path: '/testOneFile',
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'transfer-encoding': 'chunked',
    },
  },
  (res) => {
    let body = ''
    res.on('data', (d) => (body += d))
    res.on('end', () => {
      const sec = (Date.now() - t0) / 1000
      console.log(`收到响应：用时 ${sec.toFixed(2)}s（≈${(SIZE / sec / 1048576).toFixed(1)} MB/s）`)
      console.log('响应体：', body.slice(0, 220))
    })
  },
)

let sent = 0
function writeLoop() {
  let ok = true
  while (ok && sent < SIZE) {
    if (sent === 0) ok = req.write(head)
    const n = Math.min(CHUNK, SIZE - sent)
    sent += n
    ok = req.write(n === CHUNK ? zero : zero.subarray(0, n))
  }
  if (sent >= SIZE) req.end(tail)
}
req.on('drain', writeLoop)
req.on('error', (e) => console.error('请求错误:', e.message))
writeLoop()
