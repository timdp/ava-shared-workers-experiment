const { Observable } = require('rxjs')
const { share, take } = require('rxjs/operators')

const kTeardownStream = Symbol('teardownStream')

const receiveTeardown = t => {
  if (t[kTeardownStream] == null) {
    t[kTeardownStream] =
      Observable.create(obs => {
        t.teardown(() => {
          obs.next(null)
        })
      })
      |> take(1)
      |> share()
  }
  return t[kTeardownStream]
}

module.exports = receiveTeardown
