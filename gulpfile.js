const { task, src, dest, series, parallel, pipe, watch } = require('gulp');
var uglify = require('gulp-uglify');
var concat = require('gulp-concat');
var rename = require("gulp-rename");

var karma = require('karma');

var builds = {
  core: 'build/threestrap-core.js',
  extra: 'build/threestrap-extra.js',
  bundle: 'build/threestrap.js',
};

var products = [
  builds.core,
  builds.extra,
  builds.bundle,
];

var vendor = [
  'node_modules/lodash/dist/lodash.js',
];

var core = [
  'src/binder.js',
  'src/api.js',
  'src/bootstrap.js',
  'src/plugin.js',
  'src/aliases.js',
  'src/core/fallback.js',
  'src/core/renderer.js',
  'src/core/bind.js',
  'src/core/size.js',
  'src/core/fill.js',
  'src/core/loop.js',
  'src/core/time.js',
  'src/core/scene.js',
  'src/core/camera.js',
  'src/core/render.js',
  'src/core/warmup.js',
];

var extra = [
  'node_modules/three/examples/js/libs/stats.min.js',
  'node_modules/three/examples/js/controls/DeviceOrientationControls.js',
  'node_modules/three/examples/js/controls/FirstPersonControls.js',
  'node_modules/three/examples/js/controls/OrbitControls.js',
  'node_modules/three/examples/js/controls/TrackballControls.js',
  'vendor/controls/VRControls.js',
  'src/extra/stats.js',
  'src/extra/controls.js',
  'src/extra/cursor.js',
  'src/extra/fullscreen.js',
  'src/extra/vr.js',
  'src/extra/ui.js',
];

var bundle = vendor.concat(core).concat(extra);

var test = [
  'node_modules/three/build/three.js',
].concat(builds.bundle).concat([
  'test/**/*.spec.js',
]);

task('core', function () {
  return src(core)
    .pipe(concat(builds.core))
    .pipe(dest('.'));
});

task('extra', function () {
  return src(extra)
    .pipe(concat(builds.extra))
    .pipe(dest('.'));
});

task('bundle', function () {
  return src(bundle)
    .pipe(concat(builds.bundle))
    .pipe(dest('.'));
});

task('uglify-js', function () {
  return src(products)
    .pipe(uglify())
    .pipe(rename({
      extname: ".min.js"
    }))
    .pipe(dest('build'));
});

task('karma', function(done) {
  new karma.Server({
    configFile: __dirname + '/karma.conf.js',
    files: test,
    singleRun: true,
  }, function(err) {
      if (err > 0) {
        return done(new Error(`Karma exited with status code ${err}`));
      }
      done();
  }).start();
});

task('watch-karma', function(done) {
  new karma.Server({
    configFile: __dirname + '/karma.conf.js',
    files: test,
    singleRun: false,
  }, function(err) {
      if (err > 0) {
          return done(new Error(`Karma (watch) exited with status code ${err}`));
      }
  }).start();
  done();
});

// NEW: Add karma runner, triggered after every build
task('run-karma', function (done) {
    new karma.runner.run({
    configFile: __dirname + '/karma.conf.js',
    files: test,
    singleRun: true
  }, function(err) {
      if (err > 0) {
          return done(new Error(`Karma runner exited with status code ${err}`));
      }
      done();
    });
});

task('watch-build', function(done) {
  watch(bundle, series('build', 'run-karma'));
  done();
});

// Main tasks

task('build',
  series('core', 'extra', 'bundle', function buildEnd(done) {
  done();
}));

task('default',
  series('build', 'uglify-js', function defaultEnd(done) {
  done();
}));

task('test',
  series('build', 'karma', function testEnd(done) {
  done();
}));

task('watch',
  series('watch-karma', 'watch-build', function watchEnd(done) {
  done();
}));
