export default {
  nonSemVerExperiments: {
    sharedWorkers: true
  },
  timeout: '1m',
  files: ['test/**/*.spec.js'],
  babel: {
    compileAsTests: ['{test,lib}/**/*.js']
  }
}
