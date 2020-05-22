describe("loop", function () {

  it("installs start/stop methods", function () {

    var options = {
      plugins: ['loop'],
      loop: {
        start: false,
      },
    };

    var three = new THREE.Bootstrap(options);

    expect(three.Loop.start.call).toBeTruthy();
    expect(three.Loop.stop.call).toBeTruthy();

    three.destroy();

  });

  it("starts and stops", function () {

    var options = {
      plugins: ['loop'],
      loop: {
        start: false,
      },
    };

    var three = new THREE.Bootstrap(options);

    var started = false;
    var stopped = false;

    three.on('start', function () {
      started = true;
    });

    three.on('stop', function () {
      stopped = true;
    });

    expect(three.Loop.running).toBe(false);

    three.Loop.start();

    expect(three.Loop.running).toBe(true);

    three.Loop.stop();

    expect(three.Loop.running).toBe(false);

    three.Loop.start();

    expect(three.Loop.running).toBe(true);

    three.Loop.stop();

    expect(three.Loop.running).toBe(false);

    expect(started).toBe(true);
    expect(stopped).toBe(true);

    three.destroy();

  });

});

describe("loops correctly", function () {

  var pre, update, render, post, three;

  function stall(val) {
    var k, i = 0;
    var delay = 10;
    while (+new Date() <= val + delay) {
      k = ++i * ++i * ++i * ++i * ++i;
    }
  }

  beforeEach(function (done) {
    var options = {
      init: false,
      plugins: ['bind','loop'],
    };

    three = new THREE.Bootstrap(options);

    three.on('pre', function () {
      pre = +new Date();
      stall(pre);
    });
    three.on('update', function () {
      update = +new Date();
      stall(update);
    });
    three.on('render', function () {
      render = +new Date();
      stall(render);
    });
    three.on('post', function () {
      post = +new Date();
    });

    three.init();
    done();
  });

  // Hack: no option to wait for multiple async calls without using Promises
  // Create multiple beforeEach calls:
  // https://github.com/jasmine/jasmine/issues/526
  beforeEach(function (done) {
    setTimeout(function() {
      if (pre > 0) done();
    }, 500);
  });
  beforeEach(function (done) {
    setTimeout(function() {
      if(update > 0) done();
    }, 500);
  });
  beforeEach(function (done) {
    setTimeout(function() {
      if (render > 0) done();
    }, 500);
  });
  beforeEach(function (done) {
    setTimeout(function() {
      if (post > 0) done();
    }, 500);
  });

  it("wait until all loops complete", function () { // sync function
    expect(pre).toBeGreaterThan(0);
    expect(update).toBeGreaterThan(0);
    expect(render).toBeGreaterThan(0);
    expect(post).toBeGreaterThan(0);

    expect(update).toBeGreaterThan(pre);
    expect(render).toBeGreaterThan(update);
    expect(post).toBeGreaterThan(render);

    three.destroy();
  });

});
