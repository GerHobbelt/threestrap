THREE.Binder = {
  bind: function (context, globals) {
    return function (key, object) {

      // Prepare object
      if (!object.__binds) {
        object.__binds = [];
      }

      // Set base target
      var fallback = context;
      if (_.isArray(key)) {
        fallback = key[0];
        key = key[1];
      }

      // Match key
      var match = /^([^.:]*(?:\.[^.:]+)*)?(?:\:(.*))?$/.exec(key);
      var path = match[1].split(/\./g);

      var name = path.pop();
      var dest = match[2] || name;

      // Whitelisted objects
      var selector = path.shift();
      var target = {
        'this': object,
      }[selector] || globals[selector] || context[selector] || fallback;

      // Look up keys
      while (target && (key = path.shift())) { target = target[key] };

      // Attach event handler at last level
      if (target && (target.on || target.addEventListener)) {
        var callback = function (event) {
          object[dest] && object[dest](event, context);
        };

        // Polyfill for both styles of event listener adders
        THREE.Binder._polyfill(target, [ 'addEventListener', 'on' ], function (method) {
          target[method](name, callback);
        });

        // Store bind for removal later
        var bind = { target: target, name: name, callback: callback };
        object.__binds.push(bind);

        // Return callback
        return callback;
      }
      else {
        throw "Cannot bind '" + key + "' in " + this.__name;
      }
    };
  },

  unbind: function () {
    return function (object) {
      // Remove all binds belonging to object
      if (object.__binds) {

        object.__binds.forEach(function (bind) {

          // Polyfill for both styles of event listener removers
          THREE.Binder._polyfill(bind.target, [ 'removeEventListener', 'off' ], function (method) {
            bind.target[method](bind.name, bind.callback);
          });
        }.bind(this));

        object.__binds = [];
      }
    }
  },

  apply: function ( object ) {

    // THREE.EventDispatcher.prototype.apply(object); // DOESN'T WORK
    Object.assign( object, THREE.EventDispatcher.prototype );

    object.trigger     = THREE.Binder._trigger;
    object.triggerOnce = THREE.Binder._triggerOnce;

    object.on = object.addEventListener;
    object.off = object.removeEventListener;
    object.dispatchEvent = object.trigger;

  },

  ////

  _triggerOnce: function (event) {
    this.trigger(event);
    if (this._listeners) {
      delete this._listeners[event.type]
    }
  },

  _trigger: function (event) {

    if (this._listeners === undefined) return;

    var type = event.type;
    var listeners = this._listeners[type];
    if (listeners !== undefined) {

      listeners = listeners.slice()
      var length = listeners.length;

      event.target = this;
      for (var i = 0; i < length; i++) {
        // add original target as parameter for convenience
        listeners[i].call(this, event, this);
      }
    }
  },

  _polyfill: function (object, methods, callback) {
    methods.map(function (method) { return object.method });
    if (methods.length) callback(methods[0]);
  },

};

THREE.Api = {
  apply: function (object) {

    object.set = function (options) {
      var o = this.options || {};

      // Diff out changes
      var changes = _.reduce(options, function (result, value, key) {
        if (o[key] !== value) result[key] = value;
        return result;
      }, {});

      this.options = _.extend(o, changes);

      // Notify
      this.trigger({ type: 'change', options: options, changes: changes });
    };

    object.get = function () {
      return this.options;
    };

    object.api = function (object, context) {
      object = object || {};

      // Append context argument to API methods
      context && _.each(object, function (callback, key, object) {
        if (_.isFunction(callback)) {
          object[key] = _.partialRight(callback, context);
        }
      })

      object.set = this.set.bind(this);
      object.get = this.get.bind(this);

      return object;
    };

  },
};
THREE.Bootstrap = function (options) {
  if (options) {
    var args = [].slice.apply(arguments);
    options = {};

    // (element, ...)
    if (args[0] instanceof Node) {
      node = args[0];
      args = args.slice(1);

      options.element = node;
    }

    // (..., plugin, plugin, plugin)
    if (_.isString(args[0])) {
      options.plugins = args;
    }

    // (..., [plugin, plugin, plugin])
    if (_.isArray(args[0])) {
      options.plugins = args[0];
    }

    // (..., options)
    if (args[0]) {
      options = _.defaults(options, args[0]);
    }
  }

  // 'new' is optional
  if (!(this instanceof THREE.Bootstrap)) return new THREE.Bootstrap(options);

  // Apply defaults
  var defaults = {
    init: true,
    element: document.body,
    plugins: ['core'],
    aliases: {},
    plugindb: THREE.Bootstrap.Plugins || {},
    aliasdb: THREE.Bootstrap.Aliases || {},
  };
  this.__options = _.defaults(options || {}, defaults);

  // Hidden state
  this.__inited = false;
  this.__destroyed = false;
  this.__installed = [];

  // Query element
  var element = this.__options.element;
  if (element === '' + element) {
    element = document.querySelector(element);
  }

  // Global context
  this.plugins = {};
  this.element = element;

  // Update cycle
  this.trigger = this.trigger.bind(this);
  this.frame   = this.frame.bind(this);
  this.events = ['pre', 'update', 'render', 'post'].map(function (type) {
    return { type: type };
  });
  
  // Auto-init
  if (this.__options.init) {
    this.init();
  }
};

THREE.Bootstrap.prototype = {

  init: function () {
    if (this.__inited) return;
    this.__inited = true;

    // Install plugins
    this.install(this.__options.plugins);

    return this;
  },

  destroy: function () {
    if (!this.__inited) return;
    if (this.__destroyed) return;
    this.__destroyed = true;

    // Notify of imminent destruction
    this.trigger({ type: 'destroy' });

    // Then uninstall plugins
    this.uninstall();

    return this;
  },
  
  frame: function () {
    this.events.map(this.trigger);    
  },

  resolve: function (plugins) {
    plugins = _.isArray(plugins) ? plugins : [plugins];

    // Resolve alias database
    var o = this.__options;
    var aliases = _.extend({}, o.aliasdb, o.aliases);

    // Remove inline alias defs from plugins
    var filter = function (name) {
      var key = name.split(':');
      if (!key[1]) return true;
      aliases[key[0]] = [key[1]];
      return false;
    };
    plugins = _.filter(plugins, filter);

    // Unify arrays
    _.each(aliases, function (alias, key) {
      aliases[key] = _.isArray(alias) ? alias : [alias];
    });

    // Look up aliases recursively
    function recurse(list, out, level) {
      if (level >= 256) throw "Plug-in alias recursion detected.";
      list = _.filter(list, filter);
      _.each(list, function (name) {
        var alias = aliases[name];
        if (!alias) {
          out.push(name);
        }
        else {
          out = out.concat(recurse(alias, [], level + 1));
        }
      });
      return out;
    }

    return recurse(plugins, [], 0);
  },

  install: function (plugins) {
    plugins = _.isArray(plugins) ? plugins : [plugins];

    // Resolve aliases
    plugins = this.resolve(plugins);

    // Install in order
    _.each(plugins, this.__install.bind(this));

    // Fire off ready event
    this.__ready();
  },

  uninstall: function (plugins) {
    if (plugins) {
      plugins = _.isArray(plugins) ? plugins : [plugins];

      // Resolve aliases
      plugins = this.resolve(plugins);
    }

    // Uninstall in reverse order
    _.eachRight(plugins || this.__installed, this.__uninstall.bind(this));
  },

  __install: function (name) {
    // Sanity check
    var ctor = this.__options.plugindb[name];
    if (!ctor) throw "[three.install] Cannot install. '" + name + "' is not registered.";
    if (this.plugins[name]) return console.warn("[three.install] "+ name + " is already installed.");

    // Construct
    var Plugin = ctor;
    var plugin = new Plugin(this.__options[name] || {}, name);
    this.plugins[name] = plugin;

    // Install
    flag = plugin.install(this);
    this.__installed.push(plugin);

    // Then notify
    this.trigger({ type: 'install', plugin: plugin });

    // Allow early abort
    return flag;
  },

  __uninstall: function (name, alias) {
    // Sanity check
    plugin = _.isString(name) ? this.plugins[name] : name;
    if (!plugin) return console.warn("[three.uninstall] " + name + "' is not installed.");
    name = plugin.__name;

    // Uninstall
    plugin.uninstall(this);
    this.__installed = _.without(this.__installed, plugin);
    delete this.plugins[name];

    // Then notify
    this.trigger({ type: 'uninstall', plugin: plugin });
  },

  __ready: function () {
    // Notify and remove event handlers
    this.triggerOnce({ type: 'ready' });
  },

};

THREE.Binder.apply(THREE.Bootstrap.prototype);


THREE.Bootstrap.Plugins = {};
THREE.Bootstrap.Aliases = {};

THREE.Bootstrap.Plugin = function (options) {
  this.options = _.defaults(options || {}, this.defaults);
}

THREE.Bootstrap.Plugin.prototype = {

  listen: [],

  defaults: {},

  install: function (three) {

  },

  uninstall: function (three) {
  },

  ////////

};

THREE.Binder.apply(THREE.Bootstrap.Plugin.prototype);
THREE.Api   .apply(THREE.Bootstrap.Plugin.prototype);

THREE.Bootstrap.registerPlugin = function (name, spec) {
  var ctor = function (options) {
    THREE.Bootstrap.Plugin.call(this, options);
    this.__name = name;
  };
  ctor.prototype = _.extend(new THREE.Bootstrap.Plugin(), spec);

  THREE.Bootstrap.Plugins[name] = ctor;
}

THREE.Bootstrap.unregisterPlugin = function (name) {
  delete THREE.Bootstrap.Plugins[name];
}

THREE.Bootstrap.registerAlias = function (name, plugins) {
  THREE.Bootstrap.Aliases[name] = plugins;
}

THREE.Bootstrap.unregisterAlias = function (name) {
  delete THREE.Bootstrap.Aliases[name];
}

THREE.Bootstrap.registerAlias('empty', ['fallback', 'bind', 'renderer', 'size', 'fill', 'loop', 'time']);
THREE.Bootstrap.registerAlias('core', ['empty', 'scene', 'camera', 'render', 'warmup']);
THREE.Bootstrap.registerAlias('VR', ['core', 'cursor', 'fullscreen', 'render:vr']);
THREE.Bootstrap.registerPlugin('fallback', {

  defaults: {
    force:   false,
    fill:    true,
    begin:   '<div class="threestrap-fallback" style="display: table; width: 100%; height: 100%;'+
             'box-sizing: border-box; border: 1px dashed rgba(0, 0, 0, .25);">'+
             '<div style="display: table-cell; padding: 10px; vertical-align: middle; text-align: center;">',
    end:     '</div></div>',
    message: '<big><strong>This example requires WebGL</strong></big><br>'+
             'Visit <a target="_blank" href="http://get.webgl.org/">get.webgl.org</a> for more info</a>',
  },

  install: function (three) {
    var cnv;
    try {
      cnv = document.createElement('canvas');
      gl = cnv.getContext('webgl') || cnv.getContext('experimental-webgl');
      if (!gl || this.options.force) {
        throw "WebGL unavailable.";
      }
      three.fallback = false;
    }
    catch (e) {
      var message = this.options.message;
      var begin   = this.options.begin;
      var end     = this.options.end;
      var fill    = this.options.fill;

      var div = document.createElement('div');
      div.innerHTML = begin + message + end;

      this.children = []

      while (div.childNodes.length > 0) {
        this.children.push(div.firstChild);
        three.element.appendChild(div.firstChild);
      }

      if (fill) {
        three.install('fill');
      }

      this.div = div;
      three.fallback = true;
      return false; // Abort install
    }
  },

  uninstall: function (three) {
    if (this.children) {
      this.children.forEach(function (child) {
        child.parentNode.removeChild(child);
      });
      this.children = null
    }

    delete three.fallback;
  },

});
THREE.Bootstrap.registerPlugin('renderer', {

  defaults: {
    klass: THREE.WebGLRenderer,
    parameters: {
      depth: true,
      stencil: true,
      preserveDrawingBuffer: true,
      antialias: true,
    },
  },

  listen: ['resize'],

  install: function (three) {
    // Instantiate Three renderer
    var renderer = three.renderer = new this.options.klass(this.options.parameters);
    three.canvas = renderer.domElement;

    // Add to DOM
    three.element.appendChild(renderer.domElement);
  },

  uninstall: function (three) {
    // Remove from DOM
    three.element.removeChild(three.renderer.domElement);

    delete three.renderer;
    delete three.canvas;
  },

  resize: function (event, three) {
    var renderer = three.renderer;
    var el = renderer.domElement;

    // Resize renderer to render size if it's a canvas
    if (el && el.tagName == 'CANVAS') {
      renderer.setSize(event.renderWidth, event.renderHeight, false);
    }
    // Or view size if it's just a DOM element or multi-renderer
    else {
      if (renderer.setRenderSize) {
        renderer.setRenderSize(event.renderWidth, event.renderHeight);
      }
      renderer.setSize(event.viewWidth, event.viewHeight, false);
    }
  },

});

THREE.Bootstrap.registerPlugin('bind', {

  install: function (three) {
    var globals = {
      'three': three,
      'window': window,
    };

    three.bind = THREE.Binder.bind(three, globals);
    three.unbind = THREE.Binder.unbind(three);

    three.bind('install:bind', this);
    three.bind('uninstall:unbind', this);
  },

  uninstall: function (three) {
    three.unbind(this);

    delete three.bind;
    delete three.unbind;
  },

  bind: function (event, three) {
    var plugin = event.plugin;
    var listen = plugin.listen;

    listen && listen.forEach(function (key) {
      three.bind(key, plugin);
    });
  },

  unbind: function (event, three) {
    three.unbind(event.plugin);
  },

});

THREE.Bootstrap.registerPlugin('size', {

  defaults: {
    width: null,
    height: null,
    aspect: null,
    scale: 1,
    maxRenderWidth: Infinity,
    maxRenderHeight: Infinity,
    devicePixelRatio: true,
  },

  listen: [
    'window.resize:queue',
    'element.resize:queue',
    'this.change:queue',
    'ready:resize',
    'pre:pre',
  ],

  install: function (three) {

    three.Size = this.api({
      renderWidth: 0,
      renderHeight: 0,
      viewWidth: 0,
      viewHeight: 0,
    });

    this.resized = false;
  },

  uninstall: function (three) {
    delete three.Size;
  },

  queue: function (event, three) {
    this.resized = true;
  },

  pre: function (event, three) {
    if (!this.resized) return;
    this.resized = false;
    this.resize(event, three);
  },

  resize: function (event, three) {
    var options = this.options;
    var element = three.element;
    var renderer = three.renderer;

    var w, h, ew, eh, rw, rh, aspect, cut, style, ratio,
        ml = 0 , mt = 0;

    // Measure element
    w = ew = (options.width === undefined || options.width == null)
      ? element.offsetWidth || element.innerWidth || 0
      : options.width;

    h = eh = (options.height === undefined || options.height == null)
      ? element.offsetHeight || element.innerHeight || 0
      : options.height;

    // Force aspect ratio
    aspect = w / h;
    if (options.aspect) {
      if (options.aspect > aspect) {
        h = Math.round(w / options.aspect);
        mt = Math.floor((eh - h) / 2);
      }
      else {
        w = Math.round(h * options.aspect);
        ml = Math.floor((ew - w) / 2);
      }
      aspect = w / h;
    }

    // Get device pixel ratio
    ratio = 1
    if (options.devicePixelRatio && typeof window != 'undefined') {
      ratio = window.devicePixelRatio || 1
    }

    // Apply scale and resolution max
    rw = Math.round(Math.min(w * ratio * options.scale, options.maxRenderWidth));
    rh = Math.round(Math.min(h * ratio * options.scale, options.maxRenderHeight));

    // Retain aspect ratio
    raspect = rw / rh;
    if (raspect > aspect) {
      rw = Math.round(rh * aspect);
    }
    else {
      rh = Math.round(rw / aspect);
    }

    // Measure final pixel ratio
    ratio = rh / h

    // Resize and position renderer element
    style = renderer.domElement.style;
    style.width = w + "px";
    style.height = h + "px";
    style.marginLeft = ml + "px";
    style.marginTop = mt + "px";

    // Notify
    _.extend(three.Size, {
      renderWidth: rw,
      renderHeight: rh,
      viewWidth: w,
      viewHeight: h,
      aspect: aspect,
      pixelRatio: ratio,
    });

    three.trigger({
      type: 'resize',
      renderWidth: rw,
      renderHeight: rh,
      viewWidth: w,
      viewHeight: h,
      aspect: aspect,
      pixelRatio: ratio,
    });
  },

});
THREE.Bootstrap.registerPlugin('fill', {

  defaults: {
    block: true,
    body: true,
    layout: true,
  },

  install: function (three) {

    function is(element) {
      var h = element.style.height;
      return h == 'auto' || h == '';
    }

    function set(element) {
      element.style.height = '100%';
      element.style.margin = 0;
      element.style.padding = 0;
      return element;
    }

    if (this.options.body && three.element == document.body) {
      // Fix body height if we're naked
      this.applied =
        [ three.element, document.documentElement ].filter(is).map(set);
    }

    if (this.options.block && three.canvas) {
      three.canvas.style.display = 'block'
      this.block = true;
    }

    if (this.options.layout && three.element) {
      var style = window.getComputedStyle(three.element);
      if (style.position == 'static') {
        three.element.style.position = 'relative';
        this.layout = true;
      }
    }

  },

  uninstall: function (three) {
    if (this.applied) {
      function set(element) {
        element.style.height = '';
        element.style.margin = '';
        element.style.padding = '';
        return element;
      }

      this.applied.map(set);
      delete this.applied;
    }

    if (this.block && three.canvas) {
      three.canvas.style.display = '';
      delete this.block;
    }

    if (this.layout && three.element) {
      three.element.style.position = '';
      delete this.layout;
    }
  },

  change: function (three) {
    this.uninstall(three);
    this.install(three);
  },

});

THREE.Bootstrap.registerPlugin('loop', {

  defaults: {
    start: true,
    force: true,
    rate:  1,
    each: 1,
  },

  listen: ['ready', 'window.resize:reset', 'dirty', 'post'],

  install: function (three) {

    this.running = false;
    this.pending = false;
    this.lastRequestId = null;

    three.Loop = this.api({
      start: this.start.bind(this),
      stop: this.stop.bind(this),
      running: false,
      window: window,
    }, three);

    this.frame = 0;
  },

  uninstall: function (three) {
    this.stop(three);
  },

  ready: function (event, three) {
    if (this.options.start) this.start(three);
  },

  dirty: function (event, three)  {
    if (!this.running && this.options.force && !this.pending) {
      this.reset();
      this.start();
      this.pending = true;
    }
  },

  post: function (event, three) {
    this.pending = false;
  },

  reset: function () {
    this.frame = 0;
  },

  start: function (three) {
    if (this.running) return;

    three.Loop.running = this.running = true;

    var trigger = three.trigger.bind(three);
    var frames = 0;
    var loop = function () {
      if (!this.running) return;
      this.lastRequestId = three.Loop.window.requestAnimationFrame(loop);
      frames = (frames + 1) % Math.max(1, this.options.each);
      if (frames == 0) {
        this.events.map(trigger);
      }

      var rate = this.options.rate;
      if (rate <= 1 || (this.frame % rate) == 0) {
        three.frame();
      }

      this.frame++;
    }.bind(this);

    this.lastRequestId = three.Loop.window.requestAnimationFrame(loop);

    three.trigger({ type: 'start' });
  },

  stop: function (three) {
    if (!this.running) return;
    three.Loop.running = this.running = false;

    three.Loop.window.cancelAnimationFrame(this.lastRequestId);
    this.lastRequestId = null;

    three.trigger({ type: 'stop' });
  },

});
THREE.Bootstrap.registerPlugin('time', {

  defaults: {
    speed: 1,  // Clock speed
    warmup: 0, // Wait N frames before starting clock
    timeout: 1 // Timeout in seconds. Pause if no tick happens in this time.
  },

  listen: ['pre:tick', 'this.change'],

  now: function () {
    return +new Date() / 1000
  },

  install: function (three) {

    three.Time = this.api({
      now: this.now(), // Time since 1970 in seconds

      clock: 0,        // Adjustable clock that counts up from 0 seconds
      step:  1/60,     // Clock step in seconds

      frames: 0,       // Framenumber
      time: 0,         // Real time in seconds
      delta: 1/60,     // Frame step in seconds

      average: 0,      // Average frame time in seconds
      fps: 0,          // Average frames per second
    });

    this.last  = 0;
    this.time  = 0;
    this.clock = 0;
    this.wait  = this.options.warmup;

    this.clockStart = 0;
    this.timeStart  = 0;
  },

  tick: function (event, three) {
    var speed = this.options.speed;
    var timeout = this.options.timeout;

    var api = three.Time;
    var now = api.now = this.now();
    var last = this.last;
    var time = this.time;
    var clock = this.clock;

    if (last) {
      var delta   = api.delta = now - last;
      var average = api.average || delta;

      if (delta > timeout) {
        delta = 0;
      }

      var step = delta * speed;

      time  += delta;
      clock += step;

      if (api.frames > 0) {
        api.average = average + (delta - average) * .1;
        api.fps = 1 / average;
      }

      api.step  = step;
      api.clock = clock - this.clockStart;
      api.time  = time  - this.timeStart;

      api.frames++;

      if (this.wait-- > 0) {
        this.clockStart = clock;
        this.timeStart  = time;
        api.clock = 0;
        api.step  = 1e-100;
      }
    }

    this.last   = now;
    this.clock  = clock;
    this.time   = time;
  },

  uninstall: function (three) {
    delete three.Time;
  },

});
THREE.Bootstrap.registerPlugin('scene', {

  install: function (three) {
    three.scene = new THREE.Scene();
  },

  uninstall: function (three) {
    delete three.scene;
  }

});
THREE.Bootstrap.registerPlugin('camera', {

  defaults: {
    near: .01,
    far: 10000,

    type: 'perspective',
    fov: 60,
    aspect: null,

    // type: 'orthographic',
    left: -1,
    right: 1,
    bottom: -1,
    top: 1,

    klass: null,
    parameters: null,
  },

  listen: ['resize', 'this.change'],

  install: function (three) {

    three.Camera = this.api();
    three.camera = null;

    this.aspect = 1;
    this.change({}, three);
  },

  uninstall: function (three) {
    delete three.Camera;
    delete three.camera;
  },

  change: function (event, three) {
    var o = this.options;
    var old = three.camera;

    if (!three.camera || event.changes.type || event.changes.klass) {
      var klass = o.klass ||
      {
        'perspective': THREE.PerspectiveCamera,
        'orthographic': THREE.OrthographicCamera,
      }[o.type] || THREE.Camera;

      three.camera = o.parameters ? new klass(o.parameters) : new klass();
    }

    _.each(o, function (value, key) {
      if (three.camera.hasOwnProperty(key)) three.camera[key] = o[key];
    }.bind(this));

    this.update(three);

    (old === three.camera) || three.trigger({
      type: 'camera',
      camera: three.camera,
    });
  },

  resize: function (event, three) {
    this.aspect = event.viewWidth / Math.max(1, event.viewHeight);

    this.update(three);
  },

  update: function (three) {
    three.camera.aspect = this.options.aspect || this.aspect;
    three.camera.updateProjectionMatrix();
  },

});
THREE.Bootstrap.registerPlugin('render', {

  listen: ['render'],

  render: function (event, three) {
    if (three.scene && three.camera) {
      three.renderer.render(three.scene, three.camera);
    }
  },

});
THREE.Bootstrap.registerPlugin('warmup', {

  defaults: {
    delay: 2,
  },

  listen: ['ready', 'post'],

  ready: function (event, three) {
    three.renderer.domElement.style.visibility = 'hidden'
    this.frame = 0;
    this.hidden = true;
  },

  post: function (event, three) {
    if (this.hidden && this.frame >= this.options.delay) {
      three.renderer.domElement.style.visibility = 'visible'
      this.hidden = false;
    }
    this.frame++;
  },

});
// stats.js - http://github.com/mrdoob/stats.js
var Stats=function(){function h(a){c.appendChild(a.dom);return a}function k(a){for(var d=0;d<c.children.length;d++)c.children[d].style.display=d===a?"block":"none";l=a}var l=0,c=document.createElement("div");c.style.cssText="position:fixed;top:0;left:0;cursor:pointer;opacity:0.9;z-index:10000";c.addEventListener("click",function(a){a.preventDefault();k(++l%c.children.length)},!1);var g=(performance||Date).now(),e=g,a=0,r=h(new Stats.Panel("FPS","#0ff","#002")),f=h(new Stats.Panel("MS","#0f0","#020"));
if(self.performance&&self.performance.memory)var t=h(new Stats.Panel("MB","#f08","#201"));k(0);return{REVISION:16,dom:c,addPanel:h,showPanel:k,begin:function(){g=(performance||Date).now()},end:function(){a++;var c=(performance||Date).now();f.update(c-g,200);if(c>e+1E3&&(r.update(1E3*a/(c-e),100),e=c,a=0,t)){var d=performance.memory;t.update(d.usedJSHeapSize/1048576,d.jsHeapSizeLimit/1048576)}return c},update:function(){g=this.end()},domElement:c,setMode:k}};
Stats.Panel=function(h,k,l){var c=Infinity,g=0,e=Math.round,a=e(window.devicePixelRatio||1),r=80*a,f=48*a,t=3*a,u=2*a,d=3*a,m=15*a,n=74*a,p=30*a,q=document.createElement("canvas");q.width=r;q.height=f;q.style.cssText="width:80px;height:48px";var b=q.getContext("2d");b.font="bold "+9*a+"px Helvetica,Arial,sans-serif";b.textBaseline="top";b.fillStyle=l;b.fillRect(0,0,r,f);b.fillStyle=k;b.fillText(h,t,u);b.fillRect(d,m,n,p);b.fillStyle=l;b.globalAlpha=.9;b.fillRect(d,m,n,p);return{dom:q,update:function(f,
v){c=Math.min(c,f);g=Math.max(g,f);b.fillStyle=l;b.globalAlpha=1;b.fillRect(0,0,r,m);b.fillStyle=k;b.fillText(e(f)+" "+h+" ("+e(c)+"-"+e(g)+")",t,u);b.drawImage(q,d+a,m,n-a,p,d,m,n-a,p);b.fillRect(d+n-a,m,a,p);b.fillStyle=l;b.globalAlpha=.9;b.fillRect(d+n-a,m,a,e((1-f/v)*p))}}};"object"===typeof module&&(module.exports=Stats);

/**
 * @author richt / http://richt.me
 * @author WestLangley / http://github.com/WestLangley
 *
 * W3C Device Orientation control (http://w3c.github.io/deviceorientation/spec-source-orientation.html)
 */

THREE.DeviceOrientationControls = function ( object ) {

	var scope = this;

	this.object = object;
	this.object.rotation.reorder( 'YXZ' );

	this.enabled = true;

	this.deviceOrientation = {};
	this.screenOrientation = 0;

	this.alphaOffset = 0; // radians

	var onDeviceOrientationChangeEvent = function ( event ) {

		scope.deviceOrientation = event;

	};

	var onScreenOrientationChangeEvent = function () {

		scope.screenOrientation = window.orientation || 0;

	};

	// The angles alpha, beta and gamma form a set of intrinsic Tait-Bryan angles of type Z-X'-Y''

	var setObjectQuaternion = function () {

		var zee = new THREE.Vector3( 0, 0, 1 );

		var euler = new THREE.Euler();

		var q0 = new THREE.Quaternion();

		var q1 = new THREE.Quaternion( - Math.sqrt( 0.5 ), 0, 0, Math.sqrt( 0.5 ) ); // - PI/2 around the x-axis

		return function ( quaternion, alpha, beta, gamma, orient ) {

			euler.set( beta, alpha, - gamma, 'YXZ' ); // 'ZXY' for the device, but 'YXZ' for us

			quaternion.setFromEuler( euler ); // orient the device

			quaternion.multiply( q1 ); // camera looks out the back of the device, not the top

			quaternion.multiply( q0.setFromAxisAngle( zee, - orient ) ); // adjust for screen orientation

		};

	}();

	this.connect = function () {

		onScreenOrientationChangeEvent(); // run once on load

		// iOS 13+

		if ( window.DeviceOrientationEvent !== undefined && typeof window.DeviceOrientationEvent.requestPermission === 'function' ) {

			window.DeviceOrientationEvent.requestPermission().then( function ( response ) {

				if ( response == 'granted' ) {

					window.addEventListener( 'orientationchange', onScreenOrientationChangeEvent, false );
					window.addEventListener( 'deviceorientation', onDeviceOrientationChangeEvent, false );

				}

			} ).catch( function ( error ) {

				console.error( 'THREE.DeviceOrientationControls: Unable to use DeviceOrientation API:', error );

			} );

		} else {

			window.addEventListener( 'orientationchange', onScreenOrientationChangeEvent, false );
			window.addEventListener( 'deviceorientation', onDeviceOrientationChangeEvent, false );

		}

		scope.enabled = true;

	};

	this.disconnect = function () {

		window.removeEventListener( 'orientationchange', onScreenOrientationChangeEvent, false );
		window.removeEventListener( 'deviceorientation', onDeviceOrientationChangeEvent, false );

		scope.enabled = false;

	};

	this.update = function () {

		if ( scope.enabled === false ) return;

		var device = scope.deviceOrientation;

		if ( device ) {

			var alpha = device.alpha ? THREE.MathUtils.degToRad( device.alpha ) + scope.alphaOffset : 0; // Z

			var beta = device.beta ? THREE.MathUtils.degToRad( device.beta ) : 0; // X'

			var gamma = device.gamma ? THREE.MathUtils.degToRad( device.gamma ) : 0; // Y''

			var orient = scope.screenOrientation ? THREE.MathUtils.degToRad( scope.screenOrientation ) : 0; // O

			setObjectQuaternion( scope.object.quaternion, alpha, beta, gamma, orient );

		}


	};

	this.dispose = function () {

		scope.disconnect();

	};

	this.connect();

};

/**
 * @author mrdoob / http://mrdoob.com/
 * @author alteredq / http://alteredqualia.com/
 * @author paulirish / http://paulirish.com/
 */

THREE.FirstPersonControls = function ( object, domElement ) {

	if ( domElement === undefined ) {

		console.warn( 'THREE.FirstPersonControls: The second parameter "domElement" is now mandatory.' );
		domElement = document;

	}

	this.object = object;
	this.domElement = domElement;

	// API

	this.enabled = true;

	this.movementSpeed = 1.0;
	this.lookSpeed = 0.005;

	this.lookVertical = true;
	this.autoForward = false;

	this.activeLook = true;

	this.heightSpeed = false;
	this.heightCoef = 1.0;
	this.heightMin = 0.0;
	this.heightMax = 1.0;

	this.constrainVertical = false;
	this.verticalMin = 0;
	this.verticalMax = Math.PI;

	this.mouseDragOn = false;

	// internals

	this.autoSpeedFactor = 0.0;

	this.mouseX = 0;
	this.mouseY = 0;

	this.moveForward = false;
	this.moveBackward = false;
	this.moveLeft = false;
	this.moveRight = false;

	this.viewHalfX = 0;
	this.viewHalfY = 0;

	// private variables

	var lat = 0;
	var lon = 0;

	var lookDirection = new THREE.Vector3();
	var spherical = new THREE.Spherical();
	var target = new THREE.Vector3();

	//

	if ( this.domElement !== document ) {

		this.domElement.setAttribute( 'tabindex', - 1 );

	}

	//

	this.handleResize = function () {

		if ( this.domElement === document ) {

			this.viewHalfX = window.innerWidth / 2;
			this.viewHalfY = window.innerHeight / 2;

		} else {

			this.viewHalfX = this.domElement.offsetWidth / 2;
			this.viewHalfY = this.domElement.offsetHeight / 2;

		}

	};

	this.onMouseDown = function ( event ) {

		if ( this.domElement !== document ) {

			this.domElement.focus();

		}

		event.preventDefault();
		event.stopPropagation();

		if ( this.activeLook ) {

			switch ( event.button ) {

				case 0: this.moveForward = true; break;
				case 2: this.moveBackward = true; break;

			}

		}

		this.mouseDragOn = true;

	};

	this.onMouseUp = function ( event ) {

		event.preventDefault();
		event.stopPropagation();

		if ( this.activeLook ) {

			switch ( event.button ) {

				case 0: this.moveForward = false; break;
				case 2: this.moveBackward = false; break;

			}

		}

		this.mouseDragOn = false;

	};

	this.onMouseMove = function ( event ) {

		if ( this.domElement === document ) {

			this.mouseX = event.pageX - this.viewHalfX;
			this.mouseY = event.pageY - this.viewHalfY;

		} else {

			this.mouseX = event.pageX - this.domElement.offsetLeft - this.viewHalfX;
			this.mouseY = event.pageY - this.domElement.offsetTop - this.viewHalfY;

		}

	};

	this.onKeyDown = function ( event ) {

		//event.preventDefault();

		switch ( event.keyCode ) {

			case 38: /*up*/
			case 87: /*W*/ this.moveForward = true; break;

			case 37: /*left*/
			case 65: /*A*/ this.moveLeft = true; break;

			case 40: /*down*/
			case 83: /*S*/ this.moveBackward = true; break;

			case 39: /*right*/
			case 68: /*D*/ this.moveRight = true; break;

			case 82: /*R*/ this.moveUp = true; break;
			case 70: /*F*/ this.moveDown = true; break;

		}

	};

	this.onKeyUp = function ( event ) {

		switch ( event.keyCode ) {

			case 38: /*up*/
			case 87: /*W*/ this.moveForward = false; break;

			case 37: /*left*/
			case 65: /*A*/ this.moveLeft = false; break;

			case 40: /*down*/
			case 83: /*S*/ this.moveBackward = false; break;

			case 39: /*right*/
			case 68: /*D*/ this.moveRight = false; break;

			case 82: /*R*/ this.moveUp = false; break;
			case 70: /*F*/ this.moveDown = false; break;

		}

	};

	this.lookAt = function ( x, y, z ) {

		if ( x.isVector3 ) {

			target.copy( x );

		} else {

			target.set( x, y, z );

		}

		this.object.lookAt( target );

		setOrientation( this );

		return this;

	};

	this.update = function () {

		var targetPosition = new THREE.Vector3();

		return function update( delta ) {

			if ( this.enabled === false ) return;

			if ( this.heightSpeed ) {

				var y = THREE.MathUtils.clamp( this.object.position.y, this.heightMin, this.heightMax );
				var heightDelta = y - this.heightMin;

				this.autoSpeedFactor = delta * ( heightDelta * this.heightCoef );

			} else {

				this.autoSpeedFactor = 0.0;

			}

			var actualMoveSpeed = delta * this.movementSpeed;

			if ( this.moveForward || ( this.autoForward && ! this.moveBackward ) ) this.object.translateZ( - ( actualMoveSpeed + this.autoSpeedFactor ) );
			if ( this.moveBackward ) this.object.translateZ( actualMoveSpeed );

			if ( this.moveLeft ) this.object.translateX( - actualMoveSpeed );
			if ( this.moveRight ) this.object.translateX( actualMoveSpeed );

			if ( this.moveUp ) this.object.translateY( actualMoveSpeed );
			if ( this.moveDown ) this.object.translateY( - actualMoveSpeed );

			var actualLookSpeed = delta * this.lookSpeed;

			if ( ! this.activeLook ) {

				actualLookSpeed = 0;

			}

			var verticalLookRatio = 1;

			if ( this.constrainVertical ) {

				verticalLookRatio = Math.PI / ( this.verticalMax - this.verticalMin );

			}

			lon -= this.mouseX * actualLookSpeed;
			if ( this.lookVertical ) lat -= this.mouseY * actualLookSpeed * verticalLookRatio;

			lat = Math.max( - 85, Math.min( 85, lat ) );

			var phi = THREE.MathUtils.degToRad( 90 - lat );
			var theta = THREE.MathUtils.degToRad( lon );

			if ( this.constrainVertical ) {

				phi = THREE.MathUtils.mapLinear( phi, 0, Math.PI, this.verticalMin, this.verticalMax );

			}

			var position = this.object.position;

			targetPosition.setFromSphericalCoords( 1, phi, theta ).add( position );

			this.object.lookAt( targetPosition );

		};

	}();

	function contextmenu( event ) {

		event.preventDefault();

	}

	this.dispose = function () {

		this.domElement.removeEventListener( 'contextmenu', contextmenu, false );
		this.domElement.removeEventListener( 'mousedown', _onMouseDown, false );
		this.domElement.removeEventListener( 'mousemove', _onMouseMove, false );
		this.domElement.removeEventListener( 'mouseup', _onMouseUp, false );

		window.removeEventListener( 'keydown', _onKeyDown, false );
		window.removeEventListener( 'keyup', _onKeyUp, false );

	};

	var _onMouseMove = bind( this, this.onMouseMove );
	var _onMouseDown = bind( this, this.onMouseDown );
	var _onMouseUp = bind( this, this.onMouseUp );
	var _onKeyDown = bind( this, this.onKeyDown );
	var _onKeyUp = bind( this, this.onKeyUp );

	this.domElement.addEventListener( 'contextmenu', contextmenu, false );
	this.domElement.addEventListener( 'mousemove', _onMouseMove, false );
	this.domElement.addEventListener( 'mousedown', _onMouseDown, false );
	this.domElement.addEventListener( 'mouseup', _onMouseUp, false );

	window.addEventListener( 'keydown', _onKeyDown, false );
	window.addEventListener( 'keyup', _onKeyUp, false );

	function bind( scope, fn ) {

		return function () {

			fn.apply( scope, arguments );

		};

	}

	function setOrientation( controls ) {

		var quaternion = controls.object.quaternion;

		lookDirection.set( 0, 0, - 1 ).applyQuaternion( quaternion );
		spherical.setFromVector3( lookDirection );

		lat = 90 - THREE.MathUtils.radToDeg( spherical.phi );
		lon = THREE.MathUtils.radToDeg( spherical.theta );

	}

	this.handleResize();

	setOrientation( this );

};

/**
 * @author qiao / https://github.com/qiao
 * @author mrdoob / http://mrdoob.com
 * @author alteredq / http://alteredqualia.com/
 * @author WestLangley / http://github.com/WestLangley
 * @author erich666 / http://erichaines.com
 * @author ScieCode / http://github.com/sciecode
 */

// This set of controls performs orbiting, dollying (zooming), and panning.
// Unlike TrackballControls, it maintains the "up" direction object.up (+Y by default).
//
//    Orbit - left mouse / touch: one-finger move
//    Zoom - middle mouse, or mousewheel / touch: two-finger spread or squish
//    Pan - right mouse, or left mouse + ctrl/meta/shiftKey, or arrow keys / touch: two-finger move

THREE.OrbitControls = function ( object, domElement ) {

	if ( domElement === undefined ) console.warn( 'THREE.OrbitControls: The second parameter "domElement" is now mandatory.' );
	if ( domElement === document ) console.error( 'THREE.OrbitControls: "document" should not be used as the target "domElement". Please use "renderer.domElement" instead.' );

	this.object = object;
	this.domElement = domElement;

	// Set to false to disable this control
	this.enabled = true;

	// "target" sets the location of focus, where the object orbits around
	this.target = new THREE.Vector3();

	// How far you can dolly in and out ( PerspectiveCamera only )
	this.minDistance = 0;
	this.maxDistance = Infinity;

	// How far you can zoom in and out ( OrthographicCamera only )
	this.minZoom = 0;
	this.maxZoom = Infinity;

	// How far you can orbit vertically, upper and lower limits.
	// Range is 0 to Math.PI radians.
	this.minPolarAngle = 0; // radians
	this.maxPolarAngle = Math.PI; // radians

	// How far you can orbit horizontally, upper and lower limits.
	// If set, must be a sub-interval of the interval [ - Math.PI, Math.PI ].
	this.minAzimuthAngle = - Infinity; // radians
	this.maxAzimuthAngle = Infinity; // radians

	// Set to true to enable damping (inertia)
	// If damping is enabled, you must call controls.update() in your animation loop
	this.enableDamping = false;
	this.dampingFactor = 0.05;

	// This option actually enables dollying in and out; left as "zoom" for backwards compatibility.
	// Set to false to disable zooming
	this.enableZoom = true;
	this.zoomSpeed = 1.0;

	// Set to false to disable rotating
	this.enableRotate = true;
	this.rotateSpeed = 1.0;

	// Set to false to disable panning
	this.enablePan = true;
	this.panSpeed = 1.0;
	this.screenSpacePanning = false; // if true, pan in screen-space
	this.keyPanSpeed = 7.0;	// pixels moved per arrow key push

	// Set to true to automatically rotate around the target
	// If auto-rotate is enabled, you must call controls.update() in your animation loop
	this.autoRotate = false;
	this.autoRotateSpeed = 2.0; // 30 seconds per round when fps is 60

	// Set to false to disable use of the keys
	this.enableKeys = true;

	// The four arrow keys
	this.keys = { LEFT: 37, UP: 38, RIGHT: 39, BOTTOM: 40 };

	// Mouse buttons
	this.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

	// Touch fingers
	this.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

	// for reset
	this.target0 = this.target.clone();
	this.position0 = this.object.position.clone();
	this.zoom0 = this.object.zoom;

	//
	// public methods
	//

	this.getPolarAngle = function () {

		return spherical.phi;

	};

	this.getAzimuthalAngle = function () {

		return spherical.theta;

	};

	this.saveState = function () {

		scope.target0.copy( scope.target );
		scope.position0.copy( scope.object.position );
		scope.zoom0 = scope.object.zoom;

	};

	this.reset = function () {

		scope.target.copy( scope.target0 );
		scope.object.position.copy( scope.position0 );
		scope.object.zoom = scope.zoom0;

		scope.object.updateProjectionMatrix();
		scope.dispatchEvent( changeEvent );

		scope.update();

		state = STATE.NONE;

	};

	// this method is exposed, but perhaps it would be better if we can make it private...
	this.update = function () {

		var offset = new THREE.Vector3();

		// so camera.up is the orbit axis
		var quat = new THREE.Quaternion().setFromUnitVectors( object.up, new THREE.Vector3( 0, 1, 0 ) );
		var quatInverse = quat.clone().inverse();

		var lastPosition = new THREE.Vector3();
		var lastQuaternion = new THREE.Quaternion();

		return function update() {

			var position = scope.object.position;

			offset.copy( position ).sub( scope.target );

			// rotate offset to "y-axis-is-up" space
			offset.applyQuaternion( quat );

			// angle from z-axis around y-axis
			spherical.setFromVector3( offset );

			if ( scope.autoRotate && state === STATE.NONE ) {

				rotateLeft( getAutoRotationAngle() );

			}

			if ( scope.enableDamping ) {

				spherical.theta += sphericalDelta.theta * scope.dampingFactor;
				spherical.phi += sphericalDelta.phi * scope.dampingFactor;

			} else {

				spherical.theta += sphericalDelta.theta;
				spherical.phi += sphericalDelta.phi;

			}

			// restrict theta to be between desired limits
			spherical.theta = Math.max( scope.minAzimuthAngle, Math.min( scope.maxAzimuthAngle, spherical.theta ) );

			// restrict phi to be between desired limits
			spherical.phi = Math.max( scope.minPolarAngle, Math.min( scope.maxPolarAngle, spherical.phi ) );

			spherical.makeSafe();


			spherical.radius *= scale;

			// restrict radius to be between desired limits
			spherical.radius = Math.max( scope.minDistance, Math.min( scope.maxDistance, spherical.radius ) );

			// move target to panned location

			if ( scope.enableDamping === true ) {

				scope.target.addScaledVector( panOffset, scope.dampingFactor );

			} else {

				scope.target.add( panOffset );

			}

			offset.setFromSpherical( spherical );

			// rotate offset back to "camera-up-vector-is-up" space
			offset.applyQuaternion( quatInverse );

			position.copy( scope.target ).add( offset );

			scope.object.lookAt( scope.target );

			if ( scope.enableDamping === true ) {

				sphericalDelta.theta *= ( 1 - scope.dampingFactor );
				sphericalDelta.phi *= ( 1 - scope.dampingFactor );

				panOffset.multiplyScalar( 1 - scope.dampingFactor );

			} else {

				sphericalDelta.set( 0, 0, 0 );

				panOffset.set( 0, 0, 0 );

			}

			scale = 1;

			// update condition is:
			// min(camera displacement, camera rotation in radians)^2 > EPS
			// using small-angle approximation cos(x/2) = 1 - x^2 / 8

			if ( zoomChanged ||
				lastPosition.distanceToSquared( scope.object.position ) > EPS ||
				8 * ( 1 - lastQuaternion.dot( scope.object.quaternion ) ) > EPS ) {

				scope.dispatchEvent( changeEvent );

				lastPosition.copy( scope.object.position );
				lastQuaternion.copy( scope.object.quaternion );
				zoomChanged = false;

				return true;

			}

			return false;

		};

	}();

	this.dispose = function () {

		scope.domElement.removeEventListener( 'contextmenu', onContextMenu, false );
		scope.domElement.removeEventListener( 'mousedown', onMouseDown, false );
		scope.domElement.removeEventListener( 'wheel', onMouseWheel, false );

		scope.domElement.removeEventListener( 'touchstart', onTouchStart, false );
		scope.domElement.removeEventListener( 'touchend', onTouchEnd, false );
		scope.domElement.removeEventListener( 'touchmove', onTouchMove, false );

		document.removeEventListener( 'mousemove', onMouseMove, false );
		document.removeEventListener( 'mouseup', onMouseUp, false );

		scope.domElement.removeEventListener( 'keydown', onKeyDown, false );

		//scope.dispatchEvent( { type: 'dispose' } ); // should this be added here?

	};

	//
	// internals
	//

	var scope = this;

	var changeEvent = { type: 'change' };
	var startEvent = { type: 'start' };
	var endEvent = { type: 'end' };

	var STATE = {
		NONE: - 1,
		ROTATE: 0,
		DOLLY: 1,
		PAN: 2,
		TOUCH_ROTATE: 3,
		TOUCH_PAN: 4,
		TOUCH_DOLLY_PAN: 5,
		TOUCH_DOLLY_ROTATE: 6
	};

	var state = STATE.NONE;

	var EPS = 0.000001;

	// current position in spherical coordinates
	var spherical = new THREE.Spherical();
	var sphericalDelta = new THREE.Spherical();

	var scale = 1;
	var panOffset = new THREE.Vector3();
	var zoomChanged = false;

	var rotateStart = new THREE.Vector2();
	var rotateEnd = new THREE.Vector2();
	var rotateDelta = new THREE.Vector2();

	var panStart = new THREE.Vector2();
	var panEnd = new THREE.Vector2();
	var panDelta = new THREE.Vector2();

	var dollyStart = new THREE.Vector2();
	var dollyEnd = new THREE.Vector2();
	var dollyDelta = new THREE.Vector2();

	function getAutoRotationAngle() {

		return 2 * Math.PI / 60 / 60 * scope.autoRotateSpeed;

	}

	function getZoomScale() {

		return Math.pow( 0.95, scope.zoomSpeed );

	}

	function rotateLeft( angle ) {

		sphericalDelta.theta -= angle;

	}

	function rotateUp( angle ) {

		sphericalDelta.phi -= angle;

	}

	var panLeft = function () {

		var v = new THREE.Vector3();

		return function panLeft( distance, objectMatrix ) {

			v.setFromMatrixColumn( objectMatrix, 0 ); // get X column of objectMatrix
			v.multiplyScalar( - distance );

			panOffset.add( v );

		};

	}();

	var panUp = function () {

		var v = new THREE.Vector3();

		return function panUp( distance, objectMatrix ) {

			if ( scope.screenSpacePanning === true ) {

				v.setFromMatrixColumn( objectMatrix, 1 );

			} else {

				v.setFromMatrixColumn( objectMatrix, 0 );
				v.crossVectors( scope.object.up, v );

			}

			v.multiplyScalar( distance );

			panOffset.add( v );

		};

	}();

	// deltaX and deltaY are in pixels; right and down are positive
	var pan = function () {

		var offset = new THREE.Vector3();

		return function pan( deltaX, deltaY ) {

			var element = scope.domElement;

			if ( scope.object.isPerspectiveCamera ) {

				// perspective
				var position = scope.object.position;
				offset.copy( position ).sub( scope.target );
				var targetDistance = offset.length();

				// half of the fov is center to top of screen
				targetDistance *= Math.tan( ( scope.object.fov / 2 ) * Math.PI / 180.0 );

				// we use only clientHeight here so aspect ratio does not distort speed
				panLeft( 2 * deltaX * targetDistance / element.clientHeight, scope.object.matrix );
				panUp( 2 * deltaY * targetDistance / element.clientHeight, scope.object.matrix );

			} else if ( scope.object.isOrthographicCamera ) {

				// orthographic
				panLeft( deltaX * ( scope.object.right - scope.object.left ) / scope.object.zoom / element.clientWidth, scope.object.matrix );
				panUp( deltaY * ( scope.object.top - scope.object.bottom ) / scope.object.zoom / element.clientHeight, scope.object.matrix );

			} else {

				// camera neither orthographic nor perspective
				console.warn( 'WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.' );
				scope.enablePan = false;

			}

		};

	}();

	function dollyOut( dollyScale ) {

		if ( scope.object.isPerspectiveCamera ) {

			scale /= dollyScale;

		} else if ( scope.object.isOrthographicCamera ) {

			scope.object.zoom = Math.max( scope.minZoom, Math.min( scope.maxZoom, scope.object.zoom * dollyScale ) );
			scope.object.updateProjectionMatrix();
			zoomChanged = true;

		} else {

			console.warn( 'WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.' );
			scope.enableZoom = false;

		}

	}

	function dollyIn( dollyScale ) {

		if ( scope.object.isPerspectiveCamera ) {

			scale *= dollyScale;

		} else if ( scope.object.isOrthographicCamera ) {

			scope.object.zoom = Math.max( scope.minZoom, Math.min( scope.maxZoom, scope.object.zoom / dollyScale ) );
			scope.object.updateProjectionMatrix();
			zoomChanged = true;

		} else {

			console.warn( 'WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.' );
			scope.enableZoom = false;

		}

	}

	//
	// event callbacks - update the object state
	//

	function handleMouseDownRotate( event ) {

		rotateStart.set( event.clientX, event.clientY );

	}

	function handleMouseDownDolly( event ) {

		dollyStart.set( event.clientX, event.clientY );

	}

	function handleMouseDownPan( event ) {

		panStart.set( event.clientX, event.clientY );

	}

	function handleMouseMoveRotate( event ) {

		rotateEnd.set( event.clientX, event.clientY );

		rotateDelta.subVectors( rotateEnd, rotateStart ).multiplyScalar( scope.rotateSpeed );

		var element = scope.domElement;

		rotateLeft( 2 * Math.PI * rotateDelta.x / element.clientHeight ); // yes, height

		rotateUp( 2 * Math.PI * rotateDelta.y / element.clientHeight );

		rotateStart.copy( rotateEnd );

		scope.update();

	}

	function handleMouseMoveDolly( event ) {

		dollyEnd.set( event.clientX, event.clientY );

		dollyDelta.subVectors( dollyEnd, dollyStart );

		if ( dollyDelta.y > 0 ) {

			dollyOut( getZoomScale() );

		} else if ( dollyDelta.y < 0 ) {

			dollyIn( getZoomScale() );

		}

		dollyStart.copy( dollyEnd );

		scope.update();

	}

	function handleMouseMovePan( event ) {

		panEnd.set( event.clientX, event.clientY );

		panDelta.subVectors( panEnd, panStart ).multiplyScalar( scope.panSpeed );

		pan( panDelta.x, panDelta.y );

		panStart.copy( panEnd );

		scope.update();

	}

	function handleMouseUp( /*event*/ ) {

		// no-op

	}

	function handleMouseWheel( event ) {

		if ( event.deltaY < 0 ) {

			dollyIn( getZoomScale() );

		} else if ( event.deltaY > 0 ) {

			dollyOut( getZoomScale() );

		}

		scope.update();

	}

	function handleKeyDown( event ) {

		var needsUpdate = false;

		switch ( event.keyCode ) {

			case scope.keys.UP:
				pan( 0, scope.keyPanSpeed );
				needsUpdate = true;
				break;

			case scope.keys.BOTTOM:
				pan( 0, - scope.keyPanSpeed );
				needsUpdate = true;
				break;

			case scope.keys.LEFT:
				pan( scope.keyPanSpeed, 0 );
				needsUpdate = true;
				break;

			case scope.keys.RIGHT:
				pan( - scope.keyPanSpeed, 0 );
				needsUpdate = true;
				break;

		}

		if ( needsUpdate ) {

			// prevent the browser from scrolling on cursor keys
			event.preventDefault();

			scope.update();

		}


	}

	function handleTouchStartRotate( event ) {

		if ( event.touches.length == 1 ) {

			rotateStart.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );

		} else {

			var x = 0.5 * ( event.touches[ 0 ].pageX + event.touches[ 1 ].pageX );
			var y = 0.5 * ( event.touches[ 0 ].pageY + event.touches[ 1 ].pageY );

			rotateStart.set( x, y );

		}

	}

	function handleTouchStartPan( event ) {

		if ( event.touches.length == 1 ) {

			panStart.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );

		} else {

			var x = 0.5 * ( event.touches[ 0 ].pageX + event.touches[ 1 ].pageX );
			var y = 0.5 * ( event.touches[ 0 ].pageY + event.touches[ 1 ].pageY );

			panStart.set( x, y );

		}

	}

	function handleTouchStartDolly( event ) {

		var dx = event.touches[ 0 ].pageX - event.touches[ 1 ].pageX;
		var dy = event.touches[ 0 ].pageY - event.touches[ 1 ].pageY;

		var distance = Math.sqrt( dx * dx + dy * dy );

		dollyStart.set( 0, distance );

	}

	function handleTouchStartDollyPan( event ) {

		if ( scope.enableZoom ) handleTouchStartDolly( event );

		if ( scope.enablePan ) handleTouchStartPan( event );

	}

	function handleTouchStartDollyRotate( event ) {

		if ( scope.enableZoom ) handleTouchStartDolly( event );

		if ( scope.enableRotate ) handleTouchStartRotate( event );

	}

	function handleTouchMoveRotate( event ) {

		if ( event.touches.length == 1 ) {

			rotateEnd.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );

		} else {

			var x = 0.5 * ( event.touches[ 0 ].pageX + event.touches[ 1 ].pageX );
			var y = 0.5 * ( event.touches[ 0 ].pageY + event.touches[ 1 ].pageY );

			rotateEnd.set( x, y );

		}

		rotateDelta.subVectors( rotateEnd, rotateStart ).multiplyScalar( scope.rotateSpeed );

		var element = scope.domElement;

		rotateLeft( 2 * Math.PI * rotateDelta.x / element.clientHeight ); // yes, height

		rotateUp( 2 * Math.PI * rotateDelta.y / element.clientHeight );

		rotateStart.copy( rotateEnd );

	}

	function handleTouchMovePan( event ) {

		if ( event.touches.length == 1 ) {

			panEnd.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );

		} else {

			var x = 0.5 * ( event.touches[ 0 ].pageX + event.touches[ 1 ].pageX );
			var y = 0.5 * ( event.touches[ 0 ].pageY + event.touches[ 1 ].pageY );

			panEnd.set( x, y );

		}

		panDelta.subVectors( panEnd, panStart ).multiplyScalar( scope.panSpeed );

		pan( panDelta.x, panDelta.y );

		panStart.copy( panEnd );

	}

	function handleTouchMoveDolly( event ) {

		var dx = event.touches[ 0 ].pageX - event.touches[ 1 ].pageX;
		var dy = event.touches[ 0 ].pageY - event.touches[ 1 ].pageY;

		var distance = Math.sqrt( dx * dx + dy * dy );

		dollyEnd.set( 0, distance );

		dollyDelta.set( 0, Math.pow( dollyEnd.y / dollyStart.y, scope.zoomSpeed ) );

		dollyOut( dollyDelta.y );

		dollyStart.copy( dollyEnd );

	}

	function handleTouchMoveDollyPan( event ) {

		if ( scope.enableZoom ) handleTouchMoveDolly( event );

		if ( scope.enablePan ) handleTouchMovePan( event );

	}

	function handleTouchMoveDollyRotate( event ) {

		if ( scope.enableZoom ) handleTouchMoveDolly( event );

		if ( scope.enableRotate ) handleTouchMoveRotate( event );

	}

	function handleTouchEnd( /*event*/ ) {

		// no-op

	}

	//
	// event handlers - FSM: listen for events and reset state
	//

	function onMouseDown( event ) {

		if ( scope.enabled === false ) return;

		// Prevent the browser from scrolling.
		event.preventDefault();

		// Manually set the focus since calling preventDefault above
		// prevents the browser from setting it automatically.

		scope.domElement.focus ? scope.domElement.focus() : window.focus();

		var mouseAction;

		switch ( event.button ) {

			case 0:

				mouseAction = scope.mouseButtons.LEFT;
				break;

			case 1:

				mouseAction = scope.mouseButtons.MIDDLE;
				break;

			case 2:

				mouseAction = scope.mouseButtons.RIGHT;
				break;

			default:

				mouseAction = - 1;

		}

		switch ( mouseAction ) {

			case THREE.MOUSE.DOLLY:

				if ( scope.enableZoom === false ) return;

				handleMouseDownDolly( event );

				state = STATE.DOLLY;

				break;

			case THREE.MOUSE.ROTATE:

				if ( event.ctrlKey || event.metaKey || event.shiftKey ) {

					if ( scope.enablePan === false ) return;

					handleMouseDownPan( event );

					state = STATE.PAN;

				} else {

					if ( scope.enableRotate === false ) return;

					handleMouseDownRotate( event );

					state = STATE.ROTATE;

				}

				break;

			case THREE.MOUSE.PAN:

				if ( event.ctrlKey || event.metaKey || event.shiftKey ) {

					if ( scope.enableRotate === false ) return;

					handleMouseDownRotate( event );

					state = STATE.ROTATE;

				} else {

					if ( scope.enablePan === false ) return;

					handleMouseDownPan( event );

					state = STATE.PAN;

				}

				break;

			default:

				state = STATE.NONE;

		}

		if ( state !== STATE.NONE ) {

			document.addEventListener( 'mousemove', onMouseMove, false );
			document.addEventListener( 'mouseup', onMouseUp, false );

			scope.dispatchEvent( startEvent );

		}

	}

	function onMouseMove( event ) {

		if ( scope.enabled === false ) return;

		event.preventDefault();

		switch ( state ) {

			case STATE.ROTATE:

				if ( scope.enableRotate === false ) return;

				handleMouseMoveRotate( event );

				break;

			case STATE.DOLLY:

				if ( scope.enableZoom === false ) return;

				handleMouseMoveDolly( event );

				break;

			case STATE.PAN:

				if ( scope.enablePan === false ) return;

				handleMouseMovePan( event );

				break;

		}

	}

	function onMouseUp( event ) {

		if ( scope.enabled === false ) return;

		handleMouseUp( event );

		document.removeEventListener( 'mousemove', onMouseMove, false );
		document.removeEventListener( 'mouseup', onMouseUp, false );

		scope.dispatchEvent( endEvent );

		state = STATE.NONE;

	}

	function onMouseWheel( event ) {

		if ( scope.enabled === false || scope.enableZoom === false || ( state !== STATE.NONE && state !== STATE.ROTATE ) ) return;

		event.preventDefault();
		event.stopPropagation();

		scope.dispatchEvent( startEvent );

		handleMouseWheel( event );

		scope.dispatchEvent( endEvent );

	}

	function onKeyDown( event ) {

		if ( scope.enabled === false || scope.enableKeys === false || scope.enablePan === false ) return;

		handleKeyDown( event );

	}

	function onTouchStart( event ) {

		if ( scope.enabled === false ) return;

		event.preventDefault(); // prevent scrolling

		switch ( event.touches.length ) {

			case 1:

				switch ( scope.touches.ONE ) {

					case THREE.TOUCH.ROTATE:

						if ( scope.enableRotate === false ) return;

						handleTouchStartRotate( event );

						state = STATE.TOUCH_ROTATE;

						break;

					case THREE.TOUCH.PAN:

						if ( scope.enablePan === false ) return;

						handleTouchStartPan( event );

						state = STATE.TOUCH_PAN;

						break;

					default:

						state = STATE.NONE;

				}

				break;

			case 2:

				switch ( scope.touches.TWO ) {

					case THREE.TOUCH.DOLLY_PAN:

						if ( scope.enableZoom === false && scope.enablePan === false ) return;

						handleTouchStartDollyPan( event );

						state = STATE.TOUCH_DOLLY_PAN;

						break;

					case THREE.TOUCH.DOLLY_ROTATE:

						if ( scope.enableZoom === false && scope.enableRotate === false ) return;

						handleTouchStartDollyRotate( event );

						state = STATE.TOUCH_DOLLY_ROTATE;

						break;

					default:

						state = STATE.NONE;

				}

				break;

			default:

				state = STATE.NONE;

		}

		if ( state !== STATE.NONE ) {

			scope.dispatchEvent( startEvent );

		}

	}

	function onTouchMove( event ) {

		if ( scope.enabled === false ) return;

		event.preventDefault(); // prevent scrolling
		event.stopPropagation();

		switch ( state ) {

			case STATE.TOUCH_ROTATE:

				if ( scope.enableRotate === false ) return;

				handleTouchMoveRotate( event );

				scope.update();

				break;

			case STATE.TOUCH_PAN:

				if ( scope.enablePan === false ) return;

				handleTouchMovePan( event );

				scope.update();

				break;

			case STATE.TOUCH_DOLLY_PAN:

				if ( scope.enableZoom === false && scope.enablePan === false ) return;

				handleTouchMoveDollyPan( event );

				scope.update();

				break;

			case STATE.TOUCH_DOLLY_ROTATE:

				if ( scope.enableZoom === false && scope.enableRotate === false ) return;

				handleTouchMoveDollyRotate( event );

				scope.update();

				break;

			default:

				state = STATE.NONE;

		}

	}

	function onTouchEnd( event ) {

		if ( scope.enabled === false ) return;

		handleTouchEnd( event );

		scope.dispatchEvent( endEvent );

		state = STATE.NONE;

	}

	function onContextMenu( event ) {

		if ( scope.enabled === false ) return;

		event.preventDefault();

	}

	//

	scope.domElement.addEventListener( 'contextmenu', onContextMenu, false );

	scope.domElement.addEventListener( 'mousedown', onMouseDown, false );
	scope.domElement.addEventListener( 'wheel', onMouseWheel, false );

	scope.domElement.addEventListener( 'touchstart', onTouchStart, false );
	scope.domElement.addEventListener( 'touchend', onTouchEnd, false );
	scope.domElement.addEventListener( 'touchmove', onTouchMove, false );

	scope.domElement.addEventListener( 'keydown', onKeyDown, false );

	// make sure element can receive keys.

	if ( scope.domElement.tabIndex === - 1 ) {

		scope.domElement.tabIndex = 0;

	}

	// force an update at start

	this.update();

};

THREE.OrbitControls.prototype = Object.create( THREE.EventDispatcher.prototype );
THREE.OrbitControls.prototype.constructor = THREE.OrbitControls;


// This set of controls performs orbiting, dollying (zooming), and panning.
// Unlike TrackballControls, it maintains the "up" direction object.up (+Y by default).
// This is very similar to OrbitControls, another set of touch behavior
//
//    Orbit - right mouse, or left mouse + ctrl/meta/shiftKey / touch: two-finger rotate
//    Zoom - middle mouse, or mousewheel / touch: two-finger spread or squish
//    Pan - left mouse, or arrow keys / touch: one-finger move

THREE.MapControls = function ( object, domElement ) {

	THREE.OrbitControls.call( this, object, domElement );

	this.mouseButtons.LEFT = THREE.MOUSE.PAN;
	this.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;

	this.touches.ONE = THREE.TOUCH.PAN;
	this.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;

};

THREE.MapControls.prototype = Object.create( THREE.EventDispatcher.prototype );
THREE.MapControls.prototype.constructor = THREE.MapControls;

/**
 * @author Eberhard Graether / http://egraether.com/
 * @author Mark Lundin 	/ http://mark-lundin.com
 * @author Simone Manini / http://daron1337.github.io
 * @author Luca Antiga 	/ http://lantiga.github.io
 */

THREE.TrackballControls = function ( object, domElement ) {

	if ( domElement === undefined ) console.warn( 'THREE.TrackballControls: The second parameter "domElement" is now mandatory.' );
	if ( domElement === document ) console.error( 'THREE.TrackballControls: "document" should not be used as the target "domElement". Please use "renderer.domElement" instead.' );

	var _this = this;
	var STATE = { NONE: - 1, ROTATE: 0, ZOOM: 1, PAN: 2, TOUCH_ROTATE: 3, TOUCH_ZOOM_PAN: 4 };

	this.object = object;
	this.domElement = domElement;

	// API

	this.enabled = true;

	this.screen = { left: 0, top: 0, width: 0, height: 0 };

	this.rotateSpeed = 1.0;
	this.zoomSpeed = 1.2;
	this.panSpeed = 0.3;

	this.noRotate = false;
	this.noZoom = false;
	this.noPan = false;

	this.staticMoving = false;
	this.dynamicDampingFactor = 0.2;

	this.minDistance = 0;
	this.maxDistance = Infinity;

	this.keys = [ 65 /*A*/, 83 /*S*/, 68 /*D*/ ];

	this.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ZOOM, RIGHT: THREE.MOUSE.PAN };

	// internals

	this.target = new THREE.Vector3();

	var EPS = 0.000001;

	var lastPosition = new THREE.Vector3();
	var lastZoom = 1;

	var _state = STATE.NONE,
		_keyState = STATE.NONE,

		_eye = new THREE.Vector3(),

		_movePrev = new THREE.Vector2(),
		_moveCurr = new THREE.Vector2(),

		_lastAxis = new THREE.Vector3(),
		_lastAngle = 0,

		_zoomStart = new THREE.Vector2(),
		_zoomEnd = new THREE.Vector2(),

		_touchZoomDistanceStart = 0,
		_touchZoomDistanceEnd = 0,

		_panStart = new THREE.Vector2(),
		_panEnd = new THREE.Vector2();

	// for reset

	this.target0 = this.target.clone();
	this.position0 = this.object.position.clone();
	this.up0 = this.object.up.clone();
	this.zoom0 = this.object.zoom;

	// events

	var changeEvent = { type: 'change' };
	var startEvent = { type: 'start' };
	var endEvent = { type: 'end' };


	// methods

	this.handleResize = function () {

		var box = this.domElement.getBoundingClientRect();
		// adjustments come from similar code in the jquery offset() function
		var d = this.domElement.ownerDocument.documentElement;
		this.screen.left = box.left + window.pageXOffset - d.clientLeft;
		this.screen.top = box.top + window.pageYOffset - d.clientTop;
		this.screen.width = box.width;
		this.screen.height = box.height;

	};

	var getMouseOnScreen = ( function () {

		var vector = new THREE.Vector2();

		return function getMouseOnScreen( pageX, pageY ) {

			vector.set(
				( pageX - _this.screen.left ) / _this.screen.width,
				( pageY - _this.screen.top ) / _this.screen.height
			);

			return vector;

		};

	}() );

	var getMouseOnCircle = ( function () {

		var vector = new THREE.Vector2();

		return function getMouseOnCircle( pageX, pageY ) {

			vector.set(
				( ( pageX - _this.screen.width * 0.5 - _this.screen.left ) / ( _this.screen.width * 0.5 ) ),
				( ( _this.screen.height + 2 * ( _this.screen.top - pageY ) ) / _this.screen.width ) // screen.width intentional
			);

			return vector;

		};

	}() );

	this.rotateCamera = ( function () {

		var axis = new THREE.Vector3(),
			quaternion = new THREE.Quaternion(),
			eyeDirection = new THREE.Vector3(),
			objectUpDirection = new THREE.Vector3(),
			objectSidewaysDirection = new THREE.Vector3(),
			moveDirection = new THREE.Vector3(),
			angle;

		return function rotateCamera() {

			moveDirection.set( _moveCurr.x - _movePrev.x, _moveCurr.y - _movePrev.y, 0 );
			angle = moveDirection.length();

			if ( angle ) {

				_eye.copy( _this.object.position ).sub( _this.target );

				eyeDirection.copy( _eye ).normalize();
				objectUpDirection.copy( _this.object.up ).normalize();
				objectSidewaysDirection.crossVectors( objectUpDirection, eyeDirection ).normalize();

				objectUpDirection.setLength( _moveCurr.y - _movePrev.y );
				objectSidewaysDirection.setLength( _moveCurr.x - _movePrev.x );

				moveDirection.copy( objectUpDirection.add( objectSidewaysDirection ) );

				axis.crossVectors( moveDirection, _eye ).normalize();

				angle *= _this.rotateSpeed;
				quaternion.setFromAxisAngle( axis, angle );

				_eye.applyQuaternion( quaternion );
				_this.object.up.applyQuaternion( quaternion );

				_lastAxis.copy( axis );
				_lastAngle = angle;

			} else if ( ! _this.staticMoving && _lastAngle ) {

				_lastAngle *= Math.sqrt( 1.0 - _this.dynamicDampingFactor );
				_eye.copy( _this.object.position ).sub( _this.target );
				quaternion.setFromAxisAngle( _lastAxis, _lastAngle );
				_eye.applyQuaternion( quaternion );
				_this.object.up.applyQuaternion( quaternion );

			}

			_movePrev.copy( _moveCurr );

		};

	}() );


	this.zoomCamera = function () {

		var factor;

		if ( _state === STATE.TOUCH_ZOOM_PAN ) {

			factor = _touchZoomDistanceStart / _touchZoomDistanceEnd;
			_touchZoomDistanceStart = _touchZoomDistanceEnd;

			if ( _this.object.isPerspectiveCamera ) {

				_eye.multiplyScalar( factor );

			} else if ( _this.object.isOrthographicCamera ) {

				_this.object.zoom *= factor;
				_this.object.updateProjectionMatrix();

			} else {

				console.warn( 'THREE.TrackballControls: Unsupported camera type' );

			}

		} else {

			factor = 1.0 + ( _zoomEnd.y - _zoomStart.y ) * _this.zoomSpeed;

			if ( factor !== 1.0 && factor > 0.0 ) {

				if ( _this.object.isPerspectiveCamera ) {

					_eye.multiplyScalar( factor );

				} else if ( _this.object.isOrthographicCamera ) {

					_this.object.zoom /= factor;
					_this.object.updateProjectionMatrix();

				} else {

					console.warn( 'THREE.TrackballControls: Unsupported camera type' );

				}

			}

			if ( _this.staticMoving ) {

				_zoomStart.copy( _zoomEnd );

			} else {

				_zoomStart.y += ( _zoomEnd.y - _zoomStart.y ) * this.dynamicDampingFactor;

			}

		}

	};

	this.panCamera = ( function () {

		var mouseChange = new THREE.Vector2(),
			objectUp = new THREE.Vector3(),
			pan = new THREE.Vector3();

		return function panCamera() {

			mouseChange.copy( _panEnd ).sub( _panStart );

			if ( mouseChange.lengthSq() ) {

				if ( _this.object.isOrthographicCamera ) {

					var scale_x = ( _this.object.right - _this.object.left ) / _this.object.zoom / _this.domElement.clientWidth;
					var scale_y = ( _this.object.top - _this.object.bottom ) / _this.object.zoom / _this.domElement.clientWidth;

					mouseChange.x *= scale_x;
					mouseChange.y *= scale_y;

				}

				mouseChange.multiplyScalar( _eye.length() * _this.panSpeed );

				pan.copy( _eye ).cross( _this.object.up ).setLength( mouseChange.x );
				pan.add( objectUp.copy( _this.object.up ).setLength( mouseChange.y ) );

				_this.object.position.add( pan );
				_this.target.add( pan );

				if ( _this.staticMoving ) {

					_panStart.copy( _panEnd );

				} else {

					_panStart.add( mouseChange.subVectors( _panEnd, _panStart ).multiplyScalar( _this.dynamicDampingFactor ) );

				}

			}

		};

	}() );

	this.checkDistances = function () {

		if ( ! _this.noZoom || ! _this.noPan ) {

			if ( _eye.lengthSq() > _this.maxDistance * _this.maxDistance ) {

				_this.object.position.addVectors( _this.target, _eye.setLength( _this.maxDistance ) );
				_zoomStart.copy( _zoomEnd );

			}

			if ( _eye.lengthSq() < _this.minDistance * _this.minDistance ) {

				_this.object.position.addVectors( _this.target, _eye.setLength( _this.minDistance ) );
				_zoomStart.copy( _zoomEnd );

			}

		}

	};

	this.update = function () {

		_eye.subVectors( _this.object.position, _this.target );

		if ( ! _this.noRotate ) {

			_this.rotateCamera();

		}

		if ( ! _this.noZoom ) {

			_this.zoomCamera();

		}

		if ( ! _this.noPan ) {

			_this.panCamera();

		}

		_this.object.position.addVectors( _this.target, _eye );

		if ( _this.object.isPerspectiveCamera ) {

			_this.checkDistances();

			_this.object.lookAt( _this.target );

			if ( lastPosition.distanceToSquared( _this.object.position ) > EPS ) {

				_this.dispatchEvent( changeEvent );

				lastPosition.copy( _this.object.position );

			}

		} else if ( _this.object.isOrthographicCamera ) {

			_this.object.lookAt( _this.target );

			if ( lastPosition.distanceToSquared( _this.object.position ) > EPS || lastZoom !== _this.object.zoom ) {

				_this.dispatchEvent( changeEvent );

				lastPosition.copy( _this.object.position );
				lastZoom = _this.object.zoom;

			}

		} else {

			console.warn( 'THREE.TrackballControls: Unsupported camera type' );

		}

	};

	this.reset = function () {

		_state = STATE.NONE;
		_keyState = STATE.NONE;

		_this.target.copy( _this.target0 );
		_this.object.position.copy( _this.position0 );
		_this.object.up.copy( _this.up0 );
		_this.object.zoom = _this.zoom0;

		_this.object.updateProjectionMatrix();

		_eye.subVectors( _this.object.position, _this.target );

		_this.object.lookAt( _this.target );

		_this.dispatchEvent( changeEvent );

		lastPosition.copy( _this.object.position );
		lastZoom = _this.object.zoom;

	};

	// listeners

	function keydown( event ) {

		if ( _this.enabled === false ) return;

		window.removeEventListener( 'keydown', keydown );

		if ( _keyState !== STATE.NONE ) {

			return;

		} else if ( event.keyCode === _this.keys[ STATE.ROTATE ] && ! _this.noRotate ) {

			_keyState = STATE.ROTATE;

		} else if ( event.keyCode === _this.keys[ STATE.ZOOM ] && ! _this.noZoom ) {

			_keyState = STATE.ZOOM;

		} else if ( event.keyCode === _this.keys[ STATE.PAN ] && ! _this.noPan ) {

			_keyState = STATE.PAN;

		}

	}

	function keyup() {

		if ( _this.enabled === false ) return;

		_keyState = STATE.NONE;

		window.addEventListener( 'keydown', keydown, false );

	}

	function mousedown( event ) {

		if ( _this.enabled === false ) return;

		event.preventDefault();
		event.stopPropagation();

		if ( _state === STATE.NONE ) {

			switch ( event.button ) {

				case _this.mouseButtons.LEFT:
					_state = STATE.ROTATE;
					break;

				case _this.mouseButtons.MIDDLE:
					_state = STATE.ZOOM;
					break;

				case _this.mouseButtons.RIGHT:
					_state = STATE.PAN;
					break;

				default:
					_state = STATE.NONE;

			}

		}

		var state = ( _keyState !== STATE.NONE ) ? _keyState : _state;

		if ( state === STATE.ROTATE && ! _this.noRotate ) {

			_moveCurr.copy( getMouseOnCircle( event.pageX, event.pageY ) );
			_movePrev.copy( _moveCurr );

		} else if ( state === STATE.ZOOM && ! _this.noZoom ) {

			_zoomStart.copy( getMouseOnScreen( event.pageX, event.pageY ) );
			_zoomEnd.copy( _zoomStart );

		} else if ( state === STATE.PAN && ! _this.noPan ) {

			_panStart.copy( getMouseOnScreen( event.pageX, event.pageY ) );
			_panEnd.copy( _panStart );

		}

		document.addEventListener( 'mousemove', mousemove, false );
		document.addEventListener( 'mouseup', mouseup, false );

		_this.dispatchEvent( startEvent );

	}

	function mousemove( event ) {

		if ( _this.enabled === false ) return;

		event.preventDefault();
		event.stopPropagation();

		var state = ( _keyState !== STATE.NONE ) ? _keyState : _state;

		if ( state === STATE.ROTATE && ! _this.noRotate ) {

			_movePrev.copy( _moveCurr );
			_moveCurr.copy( getMouseOnCircle( event.pageX, event.pageY ) );

		} else if ( state === STATE.ZOOM && ! _this.noZoom ) {

			_zoomEnd.copy( getMouseOnScreen( event.pageX, event.pageY ) );

		} else if ( state === STATE.PAN && ! _this.noPan ) {

			_panEnd.copy( getMouseOnScreen( event.pageX, event.pageY ) );

		}

	}

	function mouseup( event ) {

		if ( _this.enabled === false ) return;

		event.preventDefault();
		event.stopPropagation();

		_state = STATE.NONE;

		document.removeEventListener( 'mousemove', mousemove );
		document.removeEventListener( 'mouseup', mouseup );
		_this.dispatchEvent( endEvent );

	}

	function mousewheel( event ) {

		if ( _this.enabled === false ) return;

		if ( _this.noZoom === true ) return;

		event.preventDefault();
		event.stopPropagation();

		switch ( event.deltaMode ) {

			case 2:
				// Zoom in pages
				_zoomStart.y -= event.deltaY * 0.025;
				break;

			case 1:
				// Zoom in lines
				_zoomStart.y -= event.deltaY * 0.01;
				break;

			default:
				// undefined, 0, assume pixels
				_zoomStart.y -= event.deltaY * 0.00025;
				break;

		}

		_this.dispatchEvent( startEvent );
		_this.dispatchEvent( endEvent );

	}

	function touchstart( event ) {

		if ( _this.enabled === false ) return;

		event.preventDefault();

		switch ( event.touches.length ) {

			case 1:
				_state = STATE.TOUCH_ROTATE;
				_moveCurr.copy( getMouseOnCircle( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY ) );
				_movePrev.copy( _moveCurr );
				break;

			default: // 2 or more
				_state = STATE.TOUCH_ZOOM_PAN;
				var dx = event.touches[ 0 ].pageX - event.touches[ 1 ].pageX;
				var dy = event.touches[ 0 ].pageY - event.touches[ 1 ].pageY;
				_touchZoomDistanceEnd = _touchZoomDistanceStart = Math.sqrt( dx * dx + dy * dy );

				var x = ( event.touches[ 0 ].pageX + event.touches[ 1 ].pageX ) / 2;
				var y = ( event.touches[ 0 ].pageY + event.touches[ 1 ].pageY ) / 2;
				_panStart.copy( getMouseOnScreen( x, y ) );
				_panEnd.copy( _panStart );
				break;

		}

		_this.dispatchEvent( startEvent );

	}

	function touchmove( event ) {

		if ( _this.enabled === false ) return;

		event.preventDefault();
		event.stopPropagation();

		switch ( event.touches.length ) {

			case 1:
				_movePrev.copy( _moveCurr );
				_moveCurr.copy( getMouseOnCircle( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY ) );
				break;

			default: // 2 or more
				var dx = event.touches[ 0 ].pageX - event.touches[ 1 ].pageX;
				var dy = event.touches[ 0 ].pageY - event.touches[ 1 ].pageY;
				_touchZoomDistanceEnd = Math.sqrt( dx * dx + dy * dy );

				var x = ( event.touches[ 0 ].pageX + event.touches[ 1 ].pageX ) / 2;
				var y = ( event.touches[ 0 ].pageY + event.touches[ 1 ].pageY ) / 2;
				_panEnd.copy( getMouseOnScreen( x, y ) );
				break;

		}

	}

	function touchend( event ) {

		if ( _this.enabled === false ) return;

		switch ( event.touches.length ) {

			case 0:
				_state = STATE.NONE;
				break;

			case 1:
				_state = STATE.TOUCH_ROTATE;
				_moveCurr.copy( getMouseOnCircle( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY ) );
				_movePrev.copy( _moveCurr );
				break;

		}

		_this.dispatchEvent( endEvent );

	}

	function contextmenu( event ) {

		if ( _this.enabled === false ) return;

		event.preventDefault();

	}

	this.dispose = function () {

		this.domElement.removeEventListener( 'contextmenu', contextmenu, false );
		this.domElement.removeEventListener( 'mousedown', mousedown, false );
		this.domElement.removeEventListener( 'wheel', mousewheel, false );

		this.domElement.removeEventListener( 'touchstart', touchstart, false );
		this.domElement.removeEventListener( 'touchend', touchend, false );
		this.domElement.removeEventListener( 'touchmove', touchmove, false );

		document.removeEventListener( 'mousemove', mousemove, false );
		document.removeEventListener( 'mouseup', mouseup, false );

		window.removeEventListener( 'keydown', keydown, false );
		window.removeEventListener( 'keyup', keyup, false );

	};

	this.domElement.addEventListener( 'contextmenu', contextmenu, false );
	this.domElement.addEventListener( 'mousedown', mousedown, false );
	this.domElement.addEventListener( 'wheel', mousewheel, false );

	this.domElement.addEventListener( 'touchstart', touchstart, false );
	this.domElement.addEventListener( 'touchend', touchend, false );
	this.domElement.addEventListener( 'touchmove', touchmove, false );

	window.addEventListener( 'keydown', keydown, false );
	window.addEventListener( 'keyup', keyup, false );

	this.handleResize();

	// force an update at start
	this.update();

};

THREE.TrackballControls.prototype = Object.create( THREE.EventDispatcher.prototype );
THREE.TrackballControls.prototype.constructor = THREE.TrackballControls;

/**
 * @author dmarcos / https://github.com/dmarcos
 * @author mrdoob / http://mrdoob.com
 */

THREE.VRControls = function ( object, onError ) {

	var scope = this;

	var vrInput;

	var standingMatrix = new THREE.Matrix4();

	function gotVRDevices( devices ) {

		for ( var i = 0; i < devices.length; i ++ ) {

			if ( ( 'VRDisplay' in window && devices[ i ] instanceof VRDisplay ) ||
				 ( 'PositionSensorVRDevice' in window && devices[ i ] instanceof PositionSensorVRDevice ) ) {

				vrInput = devices[ i ];
				break;  // We keep the first we encounter

			}

		}

		if ( !vrInput ) {

			if ( onError ) onError( 'VR input not available.' );

		}

	}

	if ( navigator.getVRDisplays ) {

		navigator.getVRDisplays().then( gotVRDevices );

	} else if ( navigator.getVRDevices ) {

		// Deprecated API.
		navigator.getVRDevices().then( gotVRDevices );

	}

	// the Rift SDK returns the position in meters
	// this scale factor allows the user to define how meters
	// are converted to scene units.

	this.scale = 1;

	// If true will use "standing space" coordinate system where y=0 is the
	// floor and x=0, z=0 is the center of the room.
	this.standing = false;

	// Distance from the users eyes to the floor in meters. Used when
	// standing=true but the VRDisplay doesn't provide stageParameters.
	this.userHeight = 1.6;

	this.update = function () {

		if ( vrInput ) {

			if ( vrInput.getPose ) {

				var pose = vrInput.getPose();

				if ( pose.orientation !== null ) {

					object.quaternion.fromArray( pose.orientation );

				}

				if ( pose.position !== null ) {

					object.position.fromArray( pose.position );

				} else {

					object.position.set( 0, 0, 0 );

				}

			} else {

				// Deprecated API.
				var state = vrInput.getState();

				if ( state.orientation !== null ) {

					object.quaternion.copy( state.orientation );

				}

				if ( state.position !== null ) {

					object.position.copy( state.position );

				} else {

					object.position.set( 0, 0, 0 );

				}

			}

			if ( this.standing ) {

				if ( vrInput.stageParameters ) {

					object.updateMatrix();

					standingMatrix.fromArray(vrInput.stageParameters.sittingToStandingTransform);
					object.applyMatrix( standingMatrix );

				} else {

					object.position.setY( object.position.y + this.userHeight );

				}

			}

			object.position.multiplyScalar( scope.scale );

		}

	};

	this.resetPose = function () {

		if ( vrInput ) {

			if ( vrInput.resetPose !== undefined ) {

				vrInput.resetPose();

			} else if ( vrInput.resetSensor !== undefined ) {

				// Deprecated API.
				vrInput.resetSensor();

			} else if ( vrInput.zeroSensor !== undefined ) {

				// Really deprecated API.
				vrInput.zeroSensor();

			}

		}

	};

	this.resetSensor = function () {

		console.warn( 'THREE.VRControls: .resetSensor() is now .resetPose().' );
		this.resetPose();

	};

	this.zeroSensor = function () {

		console.warn( 'THREE.VRControls: .zeroSensor() is now .resetPose().' );
		this.resetPose();

	};

	this.dispose = function () {

		vrInput = null;

	};

};

THREE.Bootstrap.registerPlugin('stats', {

  listen: ['pre', 'post'],

  install: function (three) {

    var stats = this.stats = new Stats();
    var style = stats.domElement.style;

    style.position = 'absolute';
    style.top = style.left = 0;
    three.element.appendChild(stats.domElement);

    three.stats = stats;
  },

  uninstall: function (three) {
    document.body.removeChild(this.stats.domElement);

    delete three.stats;
  },

  pre: function (event, three) {
    this.stats.begin();
  },

  post: function (event, three) {
    this.stats.end();
  },

});
THREE.Bootstrap.registerPlugin('controls', {

  listen: ['update', 'resize', 'camera', 'this.change'],

  defaults: {
    klass: null,
    parameters: {},
  },

  install: function (three) {
    if (!this.options.klass) throw "Must provide class for `controls.klass`";

    three.controls = null;

    this._camera = three.camera || new THREE.PerspectiveCamera();
    this.change(null, three);
  },

  uninstall: function (three) {
    delete three.controls;
  },

  change: function (event, three) {
    if (this.options.klass) {
      if (!event || event.changes.klass) {
        three.controls = new this.options.klass(this._camera, three.renderer.domElement);
      }

      _.extend(three.controls, this.options.parameters);
    }
    else {
      three.controls = null;
    }
  },

  update: function (event, three) {
    var delta = three.Time && three.Time.delta || 1/60;
    var vr = three.VR && three.VR.state;

    if (three.controls.vr) three.controls.vr(vr);
    three.controls.update(delta);
  },

  camera: function (event, three) {
    three.controls.object = this._camera = event.camera;
  },

  resize: function (event, three) {
    three.controls.handleResize && three.controls.handleResize();
  },

});
THREE.Bootstrap.registerPlugin('cursor', {

  listen: ['update', 'this.change', 'install:change', 'uninstall:change', 'element.mousemove', 'vr'],

  defaults: {
    cursor: null,
    hide: false,
    timeout: 3,
  },

  install: function (three) {
    this.timeout = this.options.timeout;
    this.element = three.element;
    this.change(null, three);
  },

  uninstall: function (three) {
    delete three.controls;
  },

  change: function (event, three) {
    this.applyCursor(three);
  },

  mousemove: function (event, three) {
    if (this.options.hide) {
      this.applyCursor(three);
      this.timeout = +this.options.timeout || 0;
    }
  },

  update: function (event, three) {
    var delta = three.Time && three.Time.delta || 1/60;

    if (this.options.hide) {
      this.timeout -= delta;
      if (this.timeout < 0) {
        this.applyCursor(three, 'none');
      }
    }
  },

  vr: function (event, three) {
    this.hide = event.active && !event.hmd.fake;
    this.applyCursor(three);
  },

  applyCursor: function (three, cursor) {
    var auto = three.controls ? 'move' : '';
    cursor = cursor || this.options.cursor || auto;
    if (this.hide) cursor = 'none';
    if (this.cursor != cursor) {
      this.element.style.cursor = cursor;
    }
  },

});
THREE.Bootstrap.registerPlugin('fullscreen', {

  defaults: {
    key: 'f',
  },

  listen: ['ready', 'update'],

  install: function (three) {
    three.Fullscreen = this.api({
      active: false,
      toggle: this.toggle.bind(this),
    }, three);
  },

  uninstall: function (three) {
    delete three.Fullscreen
  },

  ready: function (event, three) {

    document.body.addEventListener('keypress', function (event) {
      if (this.options.key &&
          event.charCode == this.options.key.charCodeAt(0)) {
        this.toggle(three);
      }
    }.bind(this));

    var changeHandler = function () {
      var active = !!document.fullscreenElement       ||
                   !!document.mozFullScreenElement    ||
                   !!document.webkitFullscreenElement ||
                   !!document.msFullscreenElement;
      three.Fullscreen.active = this.active = active;
      three.trigger({
        type: 'fullscreen',
        active: active,
      });
    }.bind(this);
    document.addEventListener("fullscreenchange", changeHandler, false);
    document.addEventListener("webkitfullscreenchange", changeHandler, false);
    document.addEventListener("mozfullscreenchange", changeHandler, false);
  },

  toggle: function (three) {
    var canvas  = three.canvas;
    var options = (three.VR && three.VR.active) ? { vrDisplay: three.VR.hmd } : {};

    if (!this.active) {

      if (canvas.requestFullScreen) {
        canvas.requestFullScreen(options);
      }
      else if (canvas.msRequestFullScreen) {
        canvas.msRequestFullscreen(options);
      }
      else if (canvas.webkitRequestFullscreen) {
        canvas.webkitRequestFullscreen(options);
      }
      else if (canvas.mozRequestFullScreen) {
        canvas.mozRequestFullScreen(options); // s vs S
      }

    }
    else {

      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
      else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
      else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen(); // s vs S
      }

    }
  },

});



/*
VR sensor / HMD hookup.
*/
THREE.Bootstrap.registerPlugin('vr', {

  defaults: {
    mode:   'auto',    // 'auto', '2d'
    device:  null,
    fov:     80,       // emulated FOV for fallback
  },

  listen: ['window.load', 'pre', 'render', 'resize', 'this.change'],

  install: function (three) {
    three.VR = this.api({
      active:   false,
      devices:  [],
      hmd:      null,
      sensor:   null,
      renderer: null,
      state:    null,
    }, three);
  },

  uninstall: function (three) {
    delete three.VR
  },

  mocks: function (three, fov, def) {
    // Fake VR device for cardboard / desktop

    // Interpuppilary distance
    var ipd = 0.03;

    // Symmetric eye FOVs (Cardboard style)
    var getEyeTranslation = function (key) { return {left: {x: -ipd, y: 0, z: 0}, right: {x: ipd, y: 0, z: 0}}[key]; };
    var getRecommendedEyeFieldOfView = function (key) {
      var camera = three.camera;
      var aspect = camera && camera.aspect || 16/9;
      var fov2   = (fov || (camera && camera.fov || def)) / 2;
      var fovX   = Math.atan(Math.tan(fov2 * Math.PI / 180) * aspect / 2) * 180 / Math.PI;
      var fovY   = fov2;

      return {
        left: {
          "rightDegrees": fovX,
          "leftDegrees":  fovX,
          "downDegrees":  fovY,
          "upDegrees":    fovY,
        },
        right: {
          "rightDegrees": fovX,
          "leftDegrees":  fovX,
          "downDegrees":  fovY,
          "upDegrees":    fovY,
        },
      }[key];
    };
    // Will be replaced with orbit controls or device orientation controls by THREE.VRControls
    var getState = function () { return {} };

    return [
      {
        fake: true,
        force: 1,
        deviceId: 'emu',
        deviceName: 'Emulated',
        getEyeTranslation: getEyeTranslation,
        getRecommendedEyeFieldOfView: getRecommendedEyeFieldOfView,
      },
      {
        force: 2,
        getState: getState,
      },
    ];
  },

  load: function (event, three) {
    var callback = function (devs) {
      this.callback(devs, three);
    }.bind(this);

    if (navigator.getVRDevices) {
      navigator.getVRDevices().then(callback);
    }
    else if (navigator.mozGetVRDevices) {
      navigator.mozGetVRDevices(callback);
    }
    else {
      console.warn('No native VR support detected.');
      callback(this.mocks(three, this.options.fov, this.defaults.fov), three);
    }
  },

  callback: function (vrdevs, three) {
    var hmd, sensor;

    var HMD    = window.HMDVRDevice            || function () {};
    var SENSOR = window.PositionSensorVRDevice || function () {};

    // Export list of devices
    vrdevs = three.VR.devices = vrdevs || three.VR.devices;

    // Get HMD device
    var deviceId = this.options.device;
    for (var i = 0; i < vrdevs.length; ++i) {
      var dev = vrdevs[i];
      if (dev.force == 1 || (dev instanceof HMD)) {
        if (deviceId && deviceId != dev.deviceId) continue;
        hmd = dev;
        break;
      }
    }

    if (hmd) {
      // Get sensor device
      for (var i = 0; i < vrdevs.length; ++i) {
        var dev = vrdevs[i];
        if (dev.force == 2 || (dev instanceof SENSOR && dev.hardwareUnitId == hmd.hardwareUnitId)) {
          sensor = dev;
          break;
        }
      }

      this.hookup(hmd, sensor, three);
    }
  },

  hookup: function (hmd, sensor, three) {
    if (!THREE.VRRenderer) console.log("THREE.VRRenderer not found");
    var klass = THREE.VRRenderer || function () {};

    this.renderer = new klass(three.renderer, hmd);
    this.hmd      = hmd;
    this.sensor   = sensor;

    three.VR.renderer = this.renderer;
    three.VR.hmd      = hmd;
    three.VR.sensor   = sensor;

    console.log("THREE.VRRenderer", hmd.deviceName);
  },

  change: function (event, three) {
    if (event.changes.device) {
      this.callback(null, three);
    }
    this.pre(event, three);
  },

  pre: function (event, three) {
    var last = this.active;

    // Global active flag
    var active = this.active = this.renderer && this.options.mode != '2d';
    three.VR.active = active;

    // Load sensor state
    if (active && this.sensor) {
      var state = this.sensor.getState();
      three.VR.state = state;
    }
    else {
      three.VR.state = null;
    }

    // Notify if VR state changed
    if (last != this.active) {
      three.trigger({ type: 'vr', active: active, hmd: this.hmd, sensor: this.sensor });
    }

  },

  resize: function (event, three) {
    if (this.active) {
      // Reinit HMD projection
      this.renderer.initialize();
    }
  },

  render: function (event, three) {
    if (three.scene && three.camera) {
      var renderer = this.active ? this.renderer : three.renderer;

      if (this.last != renderer) {
        if (renderer == three.renderer) {
          // Cleanup leftover renderer state when swapping back to normal
          var dpr    = renderer.getPixelRatio();
          var width  = renderer.domElement.width / dpr;
          var height = renderer.domElement.height / dpr;
          renderer.setScissorTest(false);
          renderer.setViewport(0, 0, width, height);
        }
      }

      this.last = renderer;

      renderer.render(three.scene, three.camera);
    }
  },

});


THREE.Bootstrap.registerPlugin('ui', {

  defaults: {
    theme: 'white',
    style: '.threestrap-ui { position: absolute; bottom: 5px; right: 5px; float: left; }'+
           '.threestrap-ui button { border: 0; background: none;'+
           '  vertical-align: middle; font-weight: bold; } '+
           '.threestrap-ui .glyphicon { top: 2px; font-weight: bold; } '+
           '@media (max-width: 640px) { .threestrap-ui button { font-size: 120% } }'+
           '.threestrap-white button { color: #fff; text-shadow: 0 1px 1px rgba(0, 0, 0, 1), '+
                                                                   '0 1px 3px rgba(0, 0, 0, 1); }'+
           '.threestrap-black button { color: #000; text-shadow: 0 0px 1px rgba(255, 255, 255, 1), '+
                                                                '0 0px 2px rgba(255, 255, 255, 1), '+
                                                                '0 0px 2px rgba(255, 255, 255, 1) }'
  },

  listen: ['fullscreen'],

  markup: function (three, theme, style) {
    var url = "//netdna.bootstrapcdn.com/bootstrap/3.0.0/css/bootstrap-glyphicons.css";
    if (location.href.match(/^file:\/\//)) url = 'http://' + url;

    var buttons = [];

    if (three.Fullscreen) {
      buttons.push('<button class="fullscreen" title="Full Screen">'+
         '<span class="glyphicon glyphicon-fullscreen"></span>'+
       '</button>');
    }
    if (three.VR) {
      buttons.push('<button class="vr" title="VR Headset">VR</button>');
    }

    return '<style type="text/css">@import url("' + url + '"); '+ style + '</style>'+
           '<div class="threestrap-ui threestrap-'+ theme + '">'+ buttons.join("\n") + '</div>';
  },

  install: function (three) {
    var ui = this.ui = document.createElement('div');
    ui.innerHTML = this.markup(three, this.options.theme, this.options.style);
    document.body.appendChild(ui);

    var fullscreen = this.ui.fullscreen = ui.querySelector('button.fullscreen');
    if (fullscreen) {
      three.bind([ fullscreen, 'click:goFullscreen' ], this);
    }

    var vr = this.ui.vr = ui.querySelector('button.vr');
    if (vr && three.VR) {
      three.VR.set({ mode: '2d' });
      three.bind([ vr, 'click:goVR' ], this);
    }
  },

  uninstall: function (three) {
    document.body.removeChild(ui);
  },

  fullscreen: function (event, three) {
    this.ui.style.display = event.active ? 'none' : 'block';
    if (!event.active) three.VR && three.VR.set({ mode: '2d' });
  },

  goFullscreen: function (event, three) {
    if (three.Fullscreen) {
      three.Fullscreen.toggle();
    }
  },

  goVR: function (event, three) {
    if (three.VR) {
      three.VR.set({ mode: 'auto' });
      three.Fullscreen.toggle();
    }
  },

  uninstall: function (three) {
    document.body.removeChild(this.ui);
  },

});