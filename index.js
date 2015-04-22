'use strict';

var through = require('through2');

/**
 * A browserify plugin that anonymises filename labels in the browser-pack.
 * @param {object} bundler The browserify bundler instance
 * @param {object} opt An options hash
 */
function browserifyAnonymousLabeler(bundler, opt) {
  if (bundler && (typeof bundler === 'object') && ('on' in pipeline) && ('bundler' in pipeline)) {
    bundler.on('reset', setupPipeline());
    setupPipeline();
  }
  else {
    throw new Error('Expected a browserify bundler instance')
  }

  /**
   * Apply the labeler to the pipeline.
   * @param {object} bundler The browserify bundler instance
   */
  function setupPipeline() {
    bundler.pipeline
      .get('label')
      .push(anonymousLabeler());
  }
}

module.exports = browserifyAnonymousLabeler;

/**
 * A pipeline labeler that ensures that final file names are anonymous in the final output
 * @returns {stream.Through} A through stream for the labelling stage
 */
function anonymousLabeler() {
  function transform(row, encoding, done) {
    /* jshint validthis:true */
    Object.keys(row.deps)
      .forEach(function eachDep(key) {
        var value = row.deps[key];
        row.deps[String(value)] = value;
        row.source = row.source
          .split(key)
          .join(value);
        delete row.deps[key];
      });
    this.push(row);
    done();
  }

  return through.obj(transform);
}