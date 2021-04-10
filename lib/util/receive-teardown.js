const { Observable } = require('rxjs')
const { share } = require('rxjs/operators')

const kTeardownStream = Symbol('teardownStream')

const receiveTeardown = t => {
  if (t[kTeardownStream] == null) {
    t[kTeardownStream] = Observable.create(obs => {
      t.teardown(() => {
        obs.next(null)
      })
    }).pipe(share())
  }
  return t[kTeardownStream]
}

module.exports = receiveTeardown
