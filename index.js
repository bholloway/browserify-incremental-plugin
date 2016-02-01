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

  // return a closure with a pluginFactory() sidecar
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

    // make getters for any existing values (cache is shared across instances)
    for (var key in internalCache) {
      defineGetterFor(depsCache, key);
    }

    // comparison cache needs to be reset every compile
    //  setting value is quicker than delete operation by an order of magnitude
    for (var key in isTestedCache) {
      isTestedCache[key] = false;
    }

    // deps stage transform
    function transform(row, encoding, done) {
      /* jshint validthis:true */
      var filename = row.file;
    
      var fileSource = null;
      try {
        fileSource = fs.readFileSync(filename).toString()
      } catch (e) {}

      if (fileSource !== null) {
        // populate the cache (overwrite)
        isTestedCache[filename] = false;
        internalCache[filename] = {
          input : fileSource,
          output: {
            id    : filename,
            source: row.source,
            deps  : merge({}, row.deps),
            file  : filename
          }
        };          
      }

      // ensure a getter is present for this key
      defineGetterFor(depsCache, filename);

      // complete
      this.push(row);
      done();
    }

    return through.obj(transform);
  }

  /**
   * Create getter on first appearance of a given key and operate through the persistent cache objects.
   * However be careful not to use any closed over variables in the getter.
   * @param {string} filename The key (file name) for the deps cache
   */
  function defineGetterFor(depsCache, filename) {

    // instead of making the property re-definable we instead make assignment idempotent
    if (!depsCache.hasOwnProperty(filename)) {
      Object.defineProperty(depsCache, filename, {get: getter});
    }

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
        var isMatch = cached.input && fs.existsSync(filename) &&
          (cached.input === fs.readFileSync(filename).toString());
        isTestedCache[filename] = true;
        internalCache[filename] = isMatch && cached;
        return getter();
      }
    }
  }
}
