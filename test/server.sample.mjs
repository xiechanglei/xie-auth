import {createAuthServer} from '../dist/index.js'


const appServer = createAuthServer().serve();

appServer.title("test server")


appServer.useAuth('/user', (ctx) => ctx.user)

appServer.use("/test", (ctx) => ctx.sendFile("/home/xie/11.jpg", {download: false, etag: true, lastModified: true, range: true}))