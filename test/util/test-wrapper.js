const { Subject } = require('rxjs')

const safeTest = (description, body) => {
  test(description, async () => {
    const hooks = {
      teardown$: new Subject()
    }
    const result = await body(hooks)
    hooks.teardown$.next()
    return result
  })
}

module.exports = { safeTest }
