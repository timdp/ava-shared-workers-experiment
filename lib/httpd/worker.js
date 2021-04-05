const debug = require('debug')('browsertest:httpd:impl')
const createFastify = require('fastify')
const expressions = require('expressions-js')
const globby = require('globby')
const micromatch = require('micromatch')
const mime = require('mime-types')
const ngrok = require('ngrok')
const fs = require('fs/promises')
const path = require('path')
const setUpWorker = require('../util/set-up-worker')

const USE_NGROK = false

const routes = new Map()
const requestWatchers = new Map()

const reTemplateVar = /\{\{(.*?)\}\}/g

let fastify = null
let serverUrl = null
let resourceCount = 0
let requestWatcherCount = 0

const interpolateTemplateVars = (str, vars) =>
  str.replace(reTemplateVar, (_, expr) => expressions.parse(expr).call(vars))

const getContentType = filename => {
  const ext = path.extname(filename)
  if (ext === '') {
    return null
  }
  const type = mime.lookup(ext)
  if (type == null || type === false) {
    return null
  }
  return type
}

const isTextContentType = type => type == null || type.startsWith('text/')

const updateRequestWatchers = url => {
  for (const watcher of requestWatchers.values()) {
    if (watcher.pathname === url.pathname) {
      watcher.match = { url: url.href }
    }
  }
}

const renderBody = async (filepath, url, contentType, templateVars) => {
  const isTemplated = templateVars != null
  const encoding = isTemplated || isTextContentType(contentType) ? 'utf8' : null
  const body = await fs.readFile(filepath, encoding)
  if (!isTemplated) {
    return body
  }
  return interpolateTemplateVars(body, {
    ...templateVars,
    fileUrl: serverUrl + url.pathname,
    dirUrl: serverUrl + path.dirname(url.pathname)
  })
}

const runRoute = async ({ filepath, templateVars }, url) => {
  const contentType = getContentType(filepath)
  const body = await renderBody(filepath, url, contentType, templateVars)
  return { contentType, body }
}

const buildReply = (reply, contentType, body) => {
  // TODO Make caching configurable
  reply.header('cache-control', 'no-store')
  reply.header('access-control-allow-origin', '*')
  if (contentType != null) {
    reply.header('content-type', contentType)
  }
  reply.send(body)
}

const registerRoutes = () => {
  // We can't add routes after calling listen(), so we handle routing ourselves
  fastify.get('/*', async (request, reply) => {
    debug('handling request', { url: request.url })
    const url = new URL(request.url, serverUrl)
    updateRequestWatchers(url)
    const route = routes.get(url.pathname)
    if (route == null) {
      reply.status(404)
      return
    }
    const { contentType, body } = await runRoute(route, url)
    buildReply(reply, contentType, body)
  })
}

const exposeServer = async () => {
  const { port } = fastify.server.address()
  if (!USE_NGROK) {
    serverUrl = 'http://127.0.0.1:' + port
  }
  debug('creating ngrok tunnel', { port })
  serverUrl = await ngrok.connect({
    addr: port,
    region: process.env.NGROK_REGION || 'eu'
  })
  debug('ngrok tunnel created', { url: serverUrl, port })
}

const unexposeServer = async () => {
  if (serverUrl == null) {
    return
  }
  if (!USE_NGROK) {
    serverUrl = null
  }
  debug('disconnecting ngrok tunnel')
  try {
    await ngrok.disconnect(serverUrl)
    await ngrok.kill()
    debug('ngrok tunnel disconnected')
  } catch (error) {
    debug('failed to disconnect ngrok tunnel', { error })
  } finally {
    serverUrl = null
  }
}

const startServer = async () => {
  debug('starting server')
  fastify = createFastify()
  registerRoutes()
  await fastify.listen()
  await exposeServer()
}

const stopServer = async () => {
  if (fastify == null) {
    return
  }
  debug('stopping server')
  try {
    await fastify.close()
    debug('server stopped')
  } catch (error) {
    debug('failed to stop server', { error })
  } finally {
    fastify = null
  }
}

const disposeServer = async () => {
  await unexposeServer()
  await stopServer()
}

exports.default = setUpWorker('httpd', startServer, disposeServer, {
  getUrl: async () => serverUrl,
  hostFile: async ({ path: filepath, templateVars = null }) => {
    const pathname = '/' + ++resourceCount
    routes.set(pathname, { filepath, templateVars })
    return {
      url: serverUrl + pathname,
      pathname
    }
  },
  unhostFile: async ({ path: filepath }) => {
    routes.delete(filepath)
  },
  hostDir: async ({ path: dirpath, templates = [], templateVars = {} }) => {
    const pathname = '/' + ++resourceCount
    const filenames = await globby('**/*', { cwd: dirpath })
    const isTemplateFilename = micromatch.matcher(templates)
    for (const filename of filenames) {
      routes.set(`${pathname}/${filename}`, {
        filepath: path.join(dirpath, filename),
        templateVars: isTemplateFilename(filename) ? templateVars : null
      })
    }
    return {
      url: serverUrl + pathname,
      pathname
    }
  },
  unhostDir: async ({ path: dirpath }) => {
    const pathnames = [...routes.keys()].filter(pathname =>
      pathname.startsWith(dirpath + '/')
    )
    for (const pathname of pathnames) {
      routes.delete(pathname)
    }
  },
  createRequestWatcher: async ({ pathname }) => {
    const id = ++requestWatcherCount
    requestWatchers.set(id, {
      id,
      pathname,
      match: null
    })
    return { id }
  },
  getRequestWatcher: async ({ id }) => requestWatchers.get(id),
  removeRequestWatcher: async ({ id }) => {
    requestWatchers.delete(id)
  }
})
