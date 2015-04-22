'use strict';

var fs = require('fs');

var through = require('through2'),
    merge   = require('lodash.merge');

/**
 * Create a context for which multiple instances of the plugin may operate with a shared cache.
 * @param {object} [cache] Optional cache
 * @returns {function} A browserify plugin
 */
function pluginFactory(cache) {

  // ensure cache
  var internalCache = cache || {};

  // return a closure with a getContext() sidecar
  browserifyIncremental.pluginFactory = pluginFactory;
  return browserifyIncremental;

  /**
   * A browserify plugin that checks incoming file context and uses cached results.
   * @param {object} bundler The browserify bundler instance
   * @param {object} opt An options hash
   */
  function browserifyIncremental(bundler, opt) {
  var isValid = bundler && (typeof bundler === 'object') &&
    (typeof bundler.on === 'function') && (typeof bundler.pipeline === 'object');
    if (isValid) {
      bundler.on('reset', setupPipeline);
      setupPipeline();
    }
    else {
      throw new Error('Expected a browserify bundler instance')
    }

    /**
     * Apply an interceptor to the pipeline.
     * @param {object} bundler The browserify bundler instance
     */
    function setupPipeline() {
      var deps = bundler.pipeline.get('deps');
      deps.push(populateCache(internalCache, deps._streams[0].cache));
    }
  }
}

module.exports = pluginFactory();

/**
 * A pipeline 'deps' stage that populates cache for incremental compile.
 * Called on fully transformed row but only when there is no cache hit.
 * @param {object} internalCache Our internal cache
 * @param {object} depsCache The cache used by module-deps
 * @returns {stream.Through} a through stream
 */
function populateCache(internalCache, depsCache) {
  function transform(row, encoding, done) {
    /* jshint validthis:true */
    var filename = row.file;

    // set the new transformed row output
    internalCache[filename] = {
      input : fs.readFileSync(filename).toString(),
      output: {
        id    : filename,
        source: row.source,
        deps  : merge({}, row.deps),
        file  : filename
      }
    };

    // we need to use a getter as it is the only hook at which we can perform comparison
    //  getters cannot be redefined so we create on first access and retain, hence the need
    //  for the internal cache to store the value above
    if (!depsCache.hasOwnProperty(filename)) {
      Object.defineProperty(depsCache, filename, {
        get: function () {
          // file read and comparison is in the order of 100us
          var cached  = internalCache[filename];
          var input   = fs.readFileSync(filename).toString();
          var isMatch = (cached.input === input);
          return isMatch ? cached.output : undefined;
        }
      });
    }

    // complete
    this.push(row);
    done();
  }
  return through.obj(transform);
}