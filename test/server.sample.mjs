import { createAuthServer } from '../dist/index.js'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'

// 临时暂存目录（handler 结束后未转存的文件会被自动清理）
const tempDir = 'e://upload'
// 正式保留目录（transferTo 的目标，演示"需保留则转存"）
const keepDir = 'e://upload_kept'

/**
 * 重新流式读取落盘文件算 md5，用于校验框架在接收时增量算出的 md5 是否正确。
 * （不一次性 readFileSync，避免大文件占内存）
 */
function digestFileMd5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

const appServer = createAuthServer()

appServer.title('upload demo')

// 配置上传：临时暂存目录 + 单文件上限（放大到 2GB 以验证流式：大文件不会把整包读进内存）
appServer.upload(tempDir, { maxSize: '5GB', maxFiles: 20,hash:true })

// ---- 单文件上传 ----
appServer.use('/testOneFile', 'POST', async (ctx) => {
  const f = ctx.files.file?.[0]
  if (!f) throw new Error('未收到文件（字段名应为 file）')

  // 校验：把已落盘的临时文件重新读一遍算 md5，和接收时增量算出的 f.md5 比对
  // const realMd5 = await digestFileMd5(f.path)
  // const md5Match = realMd5 === f.md5

  // 需要保留则转存到正式目录（以原始文件名），返回最终绝对路径
  const saved = f.transferTo(join(keepDir, f.filename))

  return {
    filename: f.filename,
    field: f.field,
    mimeType: f.mimeType,
    size: f.size,
    md5: f.md5, // 流式增量计算
    // realMd5, // 二次读盘复核
    // md5Match,
    saved,
  }
})

// ---- 多文件上传 ----
appServer.use('/testMutiFile', 'POST', async (ctx) => {
  const results = []
  // ctx.files 按字段名分组、同名归数组；遍历全部文件
  for (const arr of Object.values(ctx.files)) {
    for (const f of arr) {
      // const realMd5 = await digestFileMd5(f.path)
      // const md5Match = realMd5 === f.md5
      const saved = f.transferTo(join(keepDir, f.filename))
      results.push({
        field: f.field,
        filename: f.filename,
        size: f.size,
        md5: f.md5,
        // realMd5,
        // md5Match,
        saved,
      })
    }
  }
  if (results.length === 0) throw new Error('未收到任何文件（字段名应为 files）')

  return {
    count: results.length,
    allMatch: results.every((r) => r.md5Match),
    files: results,
  }
})

appServer.serve()

console.log('打开测试页： http://localhost:3333/upload.html')
