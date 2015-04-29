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

  // create an instance of cache populater
  var getCache = cacheFactory(internalCache);

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
      deps.push(getCache(deps._streams[0].cache));
    }
  }
}

module.exports = pluginFactory();

/**
 * A factory for a pipeline 'deps' stage.
 * @param {object} internalCache Our internal cache
 * @returns {function} a closure that will get an instance for a given depsCache
 */
function cacheFactory(internalCache) {

  // comparison cache will be use by getters
  //  since getters are persistent on the internal cache then the comparison cache also needs to be persistent
  var isTestedCache = {};

  /**
   * Get a pipeline 'deps' stage that populates cache for incremental compile.
   * Called on fully transformed row but only when there is no cache hit.
   * @param {object} depsCache The cache used by module-deps
   * @returns {stream.Through} a through stream
   */
  return function getCacheSession(depsCache) {

    // comparison cache needs to be reset every compile
    for (var key in isTestedCache) {
      delete isTestedCache[key];
    }

    // deps stage transform
    function transform(row, encoding, done) {
      /* jshint validthis:true */
      var filename = row.file;

      // set immediately
      isTestedCache[filename] = false;
      internalCache[filename] = {
        input : fs.readFileSync(filename).toString(),
        output: {
          id    : filename,
          source: row.source,
          deps  : merge({}, row.deps),
          file  : filename
        }
      };

      // create a getter
      //  we need to use a getter as it is the only hook at which we can perform comparison
      //  the value is accessed multiple times each compile cycle but is only set at the end of the cycle
      //  getters will persist for the life of the internal cache so the test cache also needs to persist
      function getter() {

        // not found
        var cached = internalCache[filename];
        if (!cached) {
          return undefined;
        }
        // we have already tested whether the cached value is valid and deleted it if not
        else if (isTestedCache[filename]) {
          return cached.output;
        }
        // test the input
        else {
          var isMatch = (cached.input === fs.readFileSync(filename).toString());
          isTestedCache[filename] = true;
          internalCache[filename] = isMatch && cached;
          return getter();
        }
      }

      // getters cannot be redefined so we create on first appearance of a given key and operate through the cache
      //  instead of closed over variable
      if (!depsCache.hasOwnProperty(filename)) {
        Object.defineProperty(depsCache, filename, {get: getter});
      }

      // complete
      this.push(row);
      done();
    }

    return through.obj(transform);
  }
}