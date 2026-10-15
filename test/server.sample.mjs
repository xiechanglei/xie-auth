import { createAuthServer } from '../dist/index.js'


const appServer = createAuthServer().serve();


appServer .useAuth('/user', (ctx) => ctx.user)