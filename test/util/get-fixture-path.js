const path = require('path')

const getFixturePath = name => path.join(__dirname, '../fixtures', name)

module.exports = getFixturePath
