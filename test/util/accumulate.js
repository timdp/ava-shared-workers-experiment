const { scan } = require('rxjs/operators')

const accumulate = () => scan((history, value) => [...history, value], [])

module.exports = accumulate
