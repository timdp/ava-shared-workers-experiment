const { BehaviorSubject } = require('rxjs')

const rememberLastValue = (values$, defaultValue = null) => {
  const subject = new BehaviorSubject(defaultValue)
  values$.subscribe(subject)
  return subject
}

module.exports = rememberLastValue
