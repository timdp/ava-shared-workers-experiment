class RequestWatcher {
  constructor (id, filter) {
    this._id = id
    this._filter = filter
    this._matches = []
  }

  get id () {
    return this._id
  }

  get filter () {
    return this._filter
  }

  get matches () {
    return this._matches
  }

  notify (timestamp, url) {
    if (this._filter.pathname === url.pathname) {
      this._matches.push({
        timestamp,
        url: url.toString()
      })
    }
  }

  toJSON () {
    return {
      id: this._id,
      filter: this._filter,
      matches: this._matches
    }
  }
}

class RequestWatchers {
  constructor () {
    this._contents = []
    this._count = 0
  }

  get (id) {
    return this._contents.find(watcher => watcher.id === id)
  }

  add (filter) {
    const id = ++this._count
    const watcher = new RequestWatcher(id, filter)
    this._contents.push(watcher)
    return watcher
  }

  remove (id) {
    const idx = this._contents.findIndex(watcher => watcher.id === id)
    if (idx < 0) {
      return
    }
    this._contents.splice(idx, 1)
  }

  notify (timestamp, url) {
    for (const watcher of this._contents) {
      watcher.notify(timestamp, url)
    }
  }

  toJSON () {
    return this._contents.map(watcher => watcher.toJSON())
  }
}

module.exports = RequestWatchers
