const debug = require('debug')('browsertest:httpd:impl')
const createFastify = require('fastify')
const fastifyCors = require('fastify-cors')
const expressions = require('expressions-js')
const globby = require('globby')
const micromatch = require('micromatch')
const mime = require('mime-types')
const ngrok = require('ngrok')
const YAML = require('js-yaml')
const fs = require('fs/promises')
const path = require('path')
const RequestWatchers = require('./util/request-watchers')
const setUpWorker = require('../util/set-up-worker')

const USE_NGROK = false

const routes = new Map()
const requestWatchers = new RequestWatchers()
const reTemplateVar = /\{\{(.*?)\}\}/g

let fastify = null
let serverUrl = null
let resourceCount = 0

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
  if (contentType != null) {
    reply.header('content-type', contentType)
  }
  reply.send(body)
}

const registerRoutes = () => {
  // We can't add routes after calling listen(), so we handle routing ourselves
  fastify.route({
    method: ['GET', 'POST'],
    url: '/*',
    handler: async (request, reply) => {
      const timestamp = Date.now()
      debug('handling request', { method: request.method, url: request.url })
      const url = new URL(request.url, serverUrl)
      requestWatchers.notify(timestamp, url)
      const route = routes.get(url.pathname)
      if (route == null) {
        reply.status(404).send('')
        return
      }
      const { contentType, body } = await runRoute(route, url)
      buildReply(reply, contentType, body)
    }
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
  fastify.register(fastifyCors, {
    origin: true,
    credentials: true
  })
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

const readConfig = async dirpath => {
  const configPath = path.join(dirpath, '_config.yml')
  try {
    const data = await fs.readFile(configPath, 'utf8')
    return YAML.load(data)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err
    }
    return {}
  }
}

const createTemplateMatcher = templates => {
  if (!Array.isArray(templates) || templates.length === 0) {
    return () => false
  }
  return micromatch.matcher(templates)
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
  hostDir: async ({ path: dirpath, templateVars = {} }) => {
    const pathname = '/' + ++resourceCount
    const filenames = await globby('**/*', { cwd: dirpath })
    const { templates } = await readConfig(dirpath)
    const isTemplateFilename = createTemplateMatcher(templates)
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
  getRequestWatchers: async () => requestWatchers.toJSON(),
  getRequestWatcher: async ({ id }) => {
    const watcher = requestWatchers.get(id)
    if (watcher == null) {
      return null
    }
    return watcher.toJSON()
  },
  createRequestWatcher: async filter => {
    const { id } = requestWatchers.add(filter)
    return { id }
  },
  removeRequestWatcher: async ({ id }) => {
    requestWatchers.remove(id)
  }
})
