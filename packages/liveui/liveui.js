Meteor.ui = Meteor.ui || {};

// TODO:
//
// - {constant:true} chunk options

(function() {

  //////////////////// PUBLIC API

  Meteor.ui.render = function (html_func, options) {
    if (typeof html_func !== "function")
      throw new Error("Meteor.ui.render() requires a function as its first argument.");

    if (Meteor.ui._inRenderMode)
      throw new Error("Can't nest Meteor.ui.render.");

    return renderChunk(html_func, options, "fragment").containerNode();
  };

  Meteor.ui.chunk = function(html_func, options) {
    if (typeof html_func !== "function")
      throw new Error("Meteor.ui.chunk() requires a function as its first argument.");

    if (Materializer.current)
      return Materializer.current.placeholder(function(comment) {
        // Wrap a new LiveRange around the comment, which becomes
        // the chunk's LiveRange.
        var range = new Meteor.ui._LiveRange(
          Meteor.ui._tag, comment, comment, true);
        // replace, don't patch, the placeholder comment
        renderChunk(html_func, options, "replace", range);
      });

    // not inside Meteor.ui.render, just return the full HTML
    var html = html_func(options && options.data);
    if (typeof html !== "string")
      throw new Error("Render function must return a string");
    return html;
  };

  Meteor.ui.listChunk = function (observable, doc_func, else_func, options) {
    if (arguments.length === 3 && typeof else_func === "object") {
      // support optional else_func, arguments (observable, doc_func, options)
      options = else_func;
      else_func = null;
    }

    if (typeof doc_func !== "function")
      throw new Error("Meteor.ui.listChunk() requires a function as first argument");

    // else_func defaults to function returning ""
    else_func = (typeof else_func === "function" ? else_func :
                 function() { return ""; });

    var itemOpts = {};
    if (options) {
      // for `preserve` to affect item updates, must be set on each item
      itemOpts.preserve = options.preserve;
    }


    var initialDocs = [];
    var queuedUpdates = [];
    var outerRange = null;
    var itemRanges = null;

    var enqueue = function(f) {
      // if we are onscreen and this is the first func
      // in the queue, schedule runQueuedUpdates.
      if (outerRange && ! queuedUpdates.length)
        Sarge.whenOnscreen(outerRange, runQueuedUpdates);

      queuedUpdates.push(f);
    };
    var runQueuedUpdates = function() {
      _.each(queuedUpdates, function(qu) { qu(); });
      queuedUpdates.length = 0;
    };

    // Helper to insert a fragment into the document based on
    // item index.
    var insertFrag = function(frag, i) {
      if (i === itemRanges.length)
        itemRanges[i-1].insert_after(frag);
      else
        itemRanges[i].insert_before(frag);
    };

    var handle = observable.observe({
      added: function(doc, before_idx) {
        if (! handle)
          initialDocs.splice(before_idx, 0, doc);
        else enqueue(function() {
          var oldRange, mode;
          if (itemRanges.length === 0) {
            oldRange = outerRange;
            mode = "inside";
          } else if (before_idx === itemRanges.length) {
            oldRange = itemRanges[itemRanges.length - 1];
            mode = "after";
          } else {
            oldRange = itemRanges[before_idx];
            mode = "before";
          }
          var range = renderChunk(doc_func, _.extend({data: doc}, itemOpts),
                                  mode, oldRange);

          itemRanges.splice(before_idx, 0, range);
        });
      },
      removed: function(doc, at_idx) {
        if (! handle)
          initialDocs.splice(at_idx, 1);
        else enqueue(function() {
          var range;
          if (itemRanges.length === 1)
            range = renderChunk(else_func, itemOpts, "inside", outerRange);
          else
            Sarge.shuck(itemRanges[at_idx].extract());

          itemRanges.splice(at_idx, 1);
        });
      },
      moved: function(doc, old_idx, new_idx) {
        if (old_idx === new_idx)
          return;

        if (! handle)
          initialDocs.splice(new_idx, 0,
                             initialDocs.splice(old_idx, 1)[0]);
        else enqueue(function() {
          // We know the list has at least two items,
          // at old_idx and new_idx, so `extract` will
          // succeed.
          var frag = itemRanges[old_idx].extract();
          var range = itemRanges.splice(old_idx, 1)[0];
          if (new_idx === itemRanges.length)
            itemRanges[itemRanges.length - 1].insert_after(frag);
          else
            itemRanges[new_idx].insert_before(frag);

          itemRanges.splice(new_idx, 0, range);
        });
      },
      changed: function(doc, at_idx) {
        if (! handle)
          initialDocs[at_idx] = doc;
        else enqueue(function() {
          renderChunk(doc_func, _.extend({data: doc}, itemOpts),
                      "patch", itemRanges[at_idx]);
        });
      }
    });

    // if not reactive, release the query handle
    if (! Materializer.current)
      handle.stop();

    // XXX support more/different public callbacks than
    // the normal created/onscreen/offscreen?

    var originalOnscreen = options && options.onscreen;
    var originalOffscreen = options && options.offscreen;

    return Meteor.ui.chunk(function() {
      if (initialDocs.length) {
        return _.map(initialDocs, function(doc) {
          return Meteor.ui.chunk(doc_func, {data: doc});
        }).join('');
      } else {
        return Meteor.ui.chunk(else_func);
      }
    }, _.extend({}, options, {
      onscreen: function (start, end, range) {
        outerRange = range;
        itemRanges = [];
        if (initialDocs.length) {
          range.visit(function (is_start, r) {
            is_start && itemRanges.push(r);
            return false;
          });
        }
        runQueuedUpdates();
        originalOnscreen && originalOnscreen.call(this, start, end, range);
      },
      offscreen: function() {
        handle.stop();
        originalOffscreen && originalOffscreen.call(this);
      }
    }));
  };

  //////////////////// RENDERCHUNK

  Meteor.ui._tag = "_liveui";

  var renderChunk = function(html_func, options, mode, oldRange) {
    if (typeof options === "string") {
      // support (html_func, mode, oldRange) form of arguments
      oldRange = mode;
      mode = options;
      options = {};
    }
    options = options || {};

    // XXX temporary backwards compatibility
    if (options.event_data)
      options.data = options.event_data;

    var range;
    var container;
    if (mode === "inside" || mode === "before" || mode === "after") {
      range = null;
      container = oldRange.containerNode();
    } else if (mode === "replace" || mode === "patch") {
      range = oldRange;
      container = oldRange.containerNode();
    } else if (mode === "fragment") {
      range = null;
      container = null;
    } else {
      throw new Error("Unknown renderChunk mode "+mode);
    }

    var cx = new Meteor.deps.Context;
    var frag = cx.run(function() {
      return (new Materializer(container)).toDOM(function() {
        var html = html_func(options.data);
        if (typeof html !== "string")
          throw new Error("Render function must return a string");
        return html;
      });
    });

    var callCreated = function() {
      range.chunkState = {};
      if (options.created) {
        // call options.created with our chunkState in this
        var ret = options.created.call(range.chunkState);
        // developer can return their own object to use as
        // chunkState instead.
        if (ret)
          range.chunkState = ret;
      };
    };

    var callOnscreen = function() {
      if (options.onscreen) {
        var ret = options.onscreen.call(
          range.chunkState, range.firstNode(), range.lastNode(), range);
        if (ret)
          range.chunkState = ret;
      }
    };

    var callOffscreen = function() {
      if (range.chunkState && options.offscreen)
        options.offscreen.call(range.chunkState);
    };

    if (! range)
      range = new Meteor.ui._LiveRange(Meteor.ui._tag, frag);

    // Table-body fix:  if container is a table and frag
    // contains a TR, wrap fragment in a TBODY on all browsers,
    // so that it will display properly in IE.
    if ((container && container.nodeName === "TABLE")
        && _.any(frag.childNodes,
                 function(n) { return n.nodeName === "TR"; })) {
      var tbody = document.createElement("TBODY");
      while (frag.firstChild)
        tbody.appendChild(frag.firstChild);
      frag.appendChild(tbody);
    }

    range.preserve = normalizePreserveOption(options.preserve);

    if (mode === "patch") {
      // Rendering top level of the current update, with patching

      var nodeMatches = matchChunks(range, frag);

      range.operate(function(start, end) {
        Sarge.shuck(start, end);

        patch(start.parentNode, frag,
                  start.previousSibling, end.nextSibling,
                  nodeMatches);
      });
    } else if (mode === "replace") {
      // Rendering a sub-chunk of the current update
      Sarge.shuck(range.replace_contents(frag));
    } else if (mode === "inside") {
      Sarge.shuck(oldRange.replace_contents(frag));
    } else if (mode === "before") {
      oldRange.insert_before(frag);
    } else if (mode === "after") {
      oldRange.insert_after(frag);
    } else if (mode === "fragment") {
      // Rendering a fragment for Meteor.ui.render
    }

    Sarge.whenOnscreen(range, function() {
      if (mode === "fragment")
        wireEvents(range, true);

      if (! range.chunkState)
        callCreated();
      callOnscreen();
    });

    range.data = options.data;
    if (options.events)
      range.eventHandlers = unpackEventMap(options.events);
    wireEvents(range, mode !== "fragment");

    // in case we are rendering on top of an existing range
    // with context, but not due to that context's invalidation.
    range.context && range.context.invalidate();

    range.context = cx;
    range.update = function() {
      var self = this;
      Sarge.whenOnscreen(self, function() {
        renderChunk(html_func, options, "patch", this);
      });
    };
    range.destroy = function() {
      range.context && range.context.invalidate();
      callOffscreen();
    };

    range.branch = options.branch;

    cx.on_invalidate(function() {
      // if range has a newer context than cx, then cx
      // is just being invalidated in order to clean
      // up its other dependencies.
      if (range.context !== cx)
        return;

      range.update();
    });

    return range;
  };

  var normalizePreserveOption = function(preserve) {
    if (preserve && _.isArray(preserve)) {
      var newPreserve = {};
      _.each(preserve, function(sel) {
        newPreserve[sel] = 1; // any constant
      });
      preserve = newPreserve;
    }
    return preserve;
  };

  //////////////////// MATERIALIZER

  // XXX check order of invalidate at multiple levels?

  var Materializer = function () {
    this.nextCommentId = 1;
    this.replaceFuncs = {};
  };
  Materializer.current = null;

  _.extend(Materializer.prototype, {
    // Calls htmlFunc() with the current Materializer used to
    // record comment placeholders for fragments.
    toDOM: function (htmlFunc) {
      var self = this;

      // run htmlFunc with self as Materializer.current
      var previous = Materializer.current;
      Materializer.current = self;
      try { var html = htmlFunc(); }
      finally { Materializer.current = previous; }

      var frag = Meteor.ui._htmlToFragment(html);
      // empty frag becomes HTML comment <!--empty-->
      if (! frag.firstChild)
        frag.appendChild(document.createComment("empty"));

      // Helper that invokes `f` on every comment node under `parent`.
      // If `f` returns a node, visit that node next.
      var each_comment = function(parent, f) {
        for (var n = parent.firstChild; n;) {
          if (n.nodeType === 8) { // COMMENT
            n = (f(n) || n.nextSibling);
            continue;
          }
          if (n.nodeType === 1) // ELEMENT
            each_comment(n, f); // recurse
          n = n.nextSibling;
        }
      };

      var alreadyCalled = function () {
        throw new Error("Can't include the same chunk in multiple places.");
      };

      each_comment(frag, function(comment) {
        var commentValue = comment.nodeValue;
        var replaceFunc = self.replaceFuncs[commentValue];
        if (! replaceFunc)
          return null; // some other <!-- comment -->

        var precomment = (comment.previousSibling || null);
        var parent = comment.parentNode;

        replaceFunc(comment);
        // plant a bomb to catch any duplicate chunk
        self.replaceFuncs[commentValue] = alreadyCalled;

        return precomment ? precomment.nextSibling : parent.firstChild;
      });

      return frag;
    },

    // Returns a new placeholder HTML comment as a string.
    // When this comment materializes, replaceFunc will be
    // called on it to replace it.
    placeholder: function (replaceFunc) {
      var commentValue = "CHUNK_"+(this.nextCommentId++);
      this.replaceFuncs[commentValue] = replaceFunc;
      return "<!--"+commentValue+"-->";
    }

  });

  //////////////////// DOM SARGE (coordinates entry, exit, and signaling)

  var Sarge = Meteor.ui._Sarge = {

    // XXX This object could keep state like lists of ranges to notify
    // are onscreen or offscreen, instead of just using individual atFlushTime
    // calls for everything.

    // Call f with (this === range) the next time we see range
    // alive and onscreen at flush time, if ever.
    whenOnscreen: function(range, f) {
      Sarge.atFlushTime(function() {
        if (! Sarge.checkOffscreen(range))
          f.call(range);
      });
    },

    // Remove all LiveRanges on the range of nodes from start to end,
    // properly disposing of any referenced chunks and cleaning the
    // nodes.  May be called as shuck(fragment) or shuck(node) as well.
    shuck: function (start, end) {
      var wrapper = new Meteor.ui._LiveRange(Meteor.ui._tag, start, end);
      wrapper.visit(function (is_start, range) {
        is_start && Sarge.killRange(range);
      });
      wrapper.destroy(true);
    },

    // Mark a single range as killed and call its finalizer.
    killRange: function(range) {
      if (! range.killed) {
        range.killed = true;
        // only one of these ever scheduled per range:
        Sarge.atFlushTime(function() {
          range.destroy && range.destroy();
        });
      }
    },

    // Call f() at next flush time.  If it's already flush time,
    // f will be added to the queue and called later in this
    // flush.
    atFlushTime: function (f) {
      var cx = new Meteor.deps.Context;
      cx.on_invalidate(function() { return f(); });
      cx.invalidate();
    },

    // If range is offscreen, kill it and shuck the whole DOM tree.
    // Returns true if the range is killed or already dead.
    checkOffscreen: function(range) {
      if (range.killed)
        return true;

      var node = range.firstNode();

      if (node.parentNode &&
          (Meteor.ui._isNodeOnscreen(node) || Sarge.isNodeHeld(node)))
        return false;

      while (node.parentNode)
        node = node.parentNode;

      Sarge.shuck(node.firstChild, node.lastChild);

      return true;
    },

    // Internal facility, only used by tests, for holding onto
    // DocumentFragments across flush().  Does ref-counting
    // using hold() and release().
    holdFrag: function (frag) {
      frag._liveui_refs = (frag._liveui_refs || 0) + 1;
    },
    releaseFrag: function (frag) {
      // Clean up on flush, if hits 0.  Wait to decrement
      // so no one else cleans it up first.
      Sarge.atFlushTime(function() {
        // now decrement
        --frag._liveui_refs;
        if (! frag._liveui_refs)
          Sarge.shuck(frag);
      });
    },
    isNodeHeld: function (node) {
      while (node.parentNode)
        node = node.parentNode;

      return node.nodeType !== 3 /*TEXT_NODE*/ && node._liveui_refs;
    }
  };

  //////////////////// EVENT SUPPORT

  var wireEvents = function(range, andEnclosing) {
    // Attach events to top-level nodes in `range` as specified
    // by its event handlers.
    //
    // If `andEnclosing` is true, we also walk up the range
    // hierarchy looking for event types we need to handle
    // based on handlers in ancestor ranges.  This is necessary
    // when a range is updated or a rendered fragment is added
    // to the DOM -- basically, when a range acquires ancestors.
    //
    // In modern browsers (all except IE <= 8), this level of
    // subtlety is not actually required, because the implementation
    // of Meteor.ui._event.registerEventType binds one handler
    // per type globally on the document.  However, the Old IE impl
    // takes advantage of it.

    var innerRange = range;
    for(range = innerRange; range; range = range.findParent()) {
      var handlers = range.eventHandlers;

      if (handlers) {
        _.each(handlers.types, function(t) {
          for(var n = innerRange.firstNode(),
                  after = innerRange.lastNode().nextSibling;
              n && n !== after;
              n = n.nextSibling)
            Meteor.ui._event.registerEventType(t, n);
        });
      }

      if (! andEnclosing)
        break;
    }
  };

  // Convert an event map from the developer into an internal
  // format for range.eventHandlers.  The internal format is
  // an array of objects with properties {type, selector, callback}.
  // The array has an expando property `types`, which is a list
  // of all the unique event types used (as an optimization for
  // code that needs this info).
  var unpackEventMap = function(events) {
    var handlers = [];

    var eventTypeSet = {};

    // iterate over `spec: callback` map
    _.each(events, function(callback, spec) {
      var clauses = spec.split(/,\s+/);
      // iterate over clauses of spec, e.g. ['click .foo', 'click .bar']
      _.each(clauses, function (clause) {
        var parts = clause.split(/\s+/);
        if (parts.length === 0)
          return;

        var type = parts.shift();
        var selector = parts.join(' ');

        handlers.push({type:type, selector:selector, callback:callback});
        eventTypeSet[type] = true;
      });
    });

    handlers.types = _.keys(eventTypeSet);
    return handlers;
  };

  // Handle a currently-propagating event on a particular node.
  // We walk all enclosing liveranges of the node, from the inside out,
  // looking for matching handlers.  If the app calls stopPropagation(),
  // we still call all handlers in all event maps for the current node.
  // If the app calls "stopImmediatePropagation()", we don't call any
  // more handlers.
  var handleEvent = function(event) {
    var curNode = event.currentTarget;
    if (! curNode)
      return;

    var innerRange = Meteor.ui._LiveRange.findRange(Meteor.ui._tag, curNode);

    var type = event.type;

    for(var range = innerRange; range; range = range.findParent()) {
      var event_handlers = range.eventHandlers;
      if (! event_handlers)
        continue;

      for(var i=0, N=event_handlers.length; i<N; i++) {
        var h = event_handlers[i];

        if (h.type !== type)
          continue;

        var selector = h.selector;
        if (selector) {
          var contextNode = range.containerNode();
          var results = Meteor.ui._findElement(contextNode, selector);
          if (! _.contains(results, curNode))
            continue;
        } else {
          // if no selector, only match the event target
          if (curNode !== event.target)
            continue;
        }

        var eventData = findEventData(event.currentTarget);

        // Call the app's handler/callback
        var returnValue = h.callback.call(eventData, event);

        // allow app to `return false` from event handler, just like
        // you can in a jquery event handler
        if (returnValue === false) {
          event.stopImmediatePropagation();
          event.preventDefault();
        }
        if (event.isImmediatePropagationStopped())
          break; // stop handling by this and other event maps
      }
    }

  };

  // find the innermost enclosing liverange that has event data
  var findEventData = function(node) {
    var innerRange = Meteor.ui._LiveRange.findRange(Meteor.ui._tag, node);

    for(var range = innerRange; range; range = range.findParent())
      if (range.data)
        return range.data;

    return null;
  };

  Meteor.ui._event.setHandler(handleEvent);


  //////////////////// DIFF / PATCH

  // Match branch keys and copy chunkState from liveranges in the
  // interior of oldRange onto matching liveranges in newFrag.
  // Return pairs of matching DOM nodes to preserve.
  var matchChunks = function(oldRange, newFrag) {
    if (! newFrag.firstChild)
      return []; // allow empty newFrag

    var oldChunks = {}; // { path -> range }
    var currentPath = []; // list of branch keys (path segments)

    // visit the interior of outerRange and call
    // `func(r, path)` on every range with a branch key,
    // where `path` is a string representation of the
    // branch key path
    var eachKeyedChunk = function(outerRange, func) {
      // call func on outerRange to support top-level unkeyed
      // chunks, like frag resulting from Template.foo()??
      func(outerRange, '');
      // visit interior of outerRange
      outerRange.visit(function(is_start, r) {
        if (r.branch) {
          if (is_start) {
            currentPath.push(r.branch);
            func(r, currentPath.join('\u0000'));
          } else {
            currentPath.pop();
          }
        }
      });
    };

    // collect old chunks keyed by their branch key paths
    eachKeyedChunk(oldRange, function(r, path) {
      oldChunks[path] = r;
    });

    // Run the selectors from preserveMap over the nodes
    // in range and create a map { label -> node }.
    var collectLabeledNodes = function(range, preserveMap) {
      var labeledNodes = {};
      _.each(preserveMap, function(labelFunc, sel) {
        var matchingNodes = Meteor.ui._findElementInRange(
          range.firstNode(), range.lastNode(), sel);
        _.each(matchingNodes, function(n) {
          // labelFunc can be a function or a constant,
          // the latter for single-match selectors {'.foo': 1}
          var pernodeLabel = (
            typeof labelFunc === 'function' ? labelFunc(n) : labelFunc);
          // falsy pernodeLabel is not considered a label
          if (pernodeLabel) {
            var fullLabel = sel+'/'+pernodeLabel;
            // in case of duplicates, we ignore the second node (this one).
            // eventually, the developer might want to get debug info.
            if (! labeledNodes[fullLabel])
              labeledNodes[fullLabel] = n;
          }
        });
      });
      return labeledNodes;
    };

    var nodeMatches = []; // [[oldNode, newNode], ...]

    // create a temporary range around newFrag in order
    // to visit it.
    var tempRange = new Meteor.ui._LiveRange(Meteor.ui._tag, newFrag);
    // visit new frag
    eachKeyedChunk(tempRange, function(r, path) {
      var oldRange = oldChunks[path];
      if (oldRange) {
        var preserveMap;
        if (r === tempRange) {
          // top level; don't copy chunkState to tempRange!
          // use oldRange.preserve for preservation
          preserveMap = oldRange.preserve;
        } else {
          // copy over chunkState
          r.chunkState = oldRange.chunkState;
          oldRange.chunkState = null; // don't call offscreen() on old range
          preserveMap = r.preserve;
        }
        // any second occurrence of `path` is ignored (not matched)
        delete oldChunks[path];

        var oldLabeledNodes = collectLabeledNodes(oldRange, preserveMap);
        var newLabeledNodes = collectLabeledNodes(r, preserveMap);
        _.each(newLabeledNodes, function(newNode, label) {
          var oldNode = oldLabeledNodes[label];
          if (oldNode)
            nodeMatches.push([oldNode, newNode]);
        });
      }
    });
    tempRange.destroy();

    return nodeMatches;
  };

  var patch = function(tgtParent, srcParent, tgtBefore, tgtAfter, nodeMatches) {

    var copyFunc = function(t, s) {
      Meteor.ui._LiveRange.transplant_tag(Meteor.ui._tag, t, s);
    };

    var patcher = new Meteor.ui._Patcher(
      tgtParent, srcParent, tgtBefore, tgtAfter);


    var visitNodes = function(parent, before, after, func) {
      for(var n = before ? before.nextSibling : parent.firstChild;
          n && n !== after;
          n = n.nextSibling) {
        if (func(n) !== false && n.firstChild)
          visitNodes(n, null, null, func);
      }
    };

    var lastTgtMatch = null;

    visitNodes(srcParent, null, null, function(src) {
      // XXX inefficient to scan for match for every node!
      var pair = _.find(nodeMatches, function(p) {
        return p[1] === src;
      });
      if (pair) {
        var tgt = pair[0];
        if (! lastTgtMatch ||
            Meteor.ui._elementOrder(lastTgtMatch, tgt) > 0) {
          if (patcher.match(tgt, src, copyFunc)) {
            // match succeeded
            lastTgtMatch = tgt;
            if (tgt.firstChild || src.firstChild) {
              // Don't patch contents of TEXTAREA tag,
              // which are only the initial contents but
              // may affect the tag's .value in IE.
              if (tgt.nodeName !== "TEXTAREA") {
                // recurse!
                patch(tgt, src, null, null, nodeMatches);
              }
            }
            return false; // tell visitNodes not to recurse
          }
        }
      }
      return true;
    });

    patcher.finish();

  };

})();
