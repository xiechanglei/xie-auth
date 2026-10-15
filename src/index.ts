/**
 * @xie-work/xie-auth
 * 提供给第三方 Node.js 项目的嵌入式认证服务库。
 */
import { AuthServer } from './AuthServer.js'

/** 创建一个可链式配置的认证服务构建器 */
export function createAuthServer(): AuthServer {
  return new AuthServer()
}

export { AuthServer } from './AuthServer.js'
export type {
  Access,
  ApiResult,
  Ctx,
  FilesField,
  Handler,
  PublicUser,
  ResolvedUploadConfig,
  Settings,
  StoredUser,
  UploadOptions,
  UploadedFile,
  UserRole,
  UserStatus,
} from './types.js'
