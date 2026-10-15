import { createAuthServer } from '../dist/index.js'


const appServer = createAuthServer().serve();

appServer.title("test server")


appServer .useAuth('/user', (ctx) => ctx.user)