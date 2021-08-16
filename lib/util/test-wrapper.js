const { Subject } = require('rxjs')

const wrapTest = (description, body) => {
  test(description, async () => {
    const hooks = {
      teardown$: new Subject()
    }
    const result = await body(hooks)
    hooks.teardown$.next()
    return result
  })
}

module.exports = { wrapTest }
