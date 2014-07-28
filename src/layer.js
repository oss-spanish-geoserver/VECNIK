
var Geometry = require('./geometry');

// do this only when Leaflet exists (aka don't when run in web worker)
if (typeof L !== 'undefined') {
  var Tile = require('./tile');
  var Profiler = require('./profiler');

  var Layer = module.exports = L.TileLayer.extend({

    options: {
      maxZoom: 22
    },

    initialize: function(options) {
      // applies to a single tile but we don't want to check on per tile basis
      if (!options.provider) {
        throw new Error('VECNIK.Tile requires a data provider');
      }
      this._provider = options.provider;

      // TODO: use internal renderer as default
      // applies to a single tile but we don'T want to check on per tile basis
      if (!options.renderer) {
        throw new Error('VECNIK.Tile requires a renderer');
      }
      this._renderer = options.renderer;

      this._tileObjects = {};
      this._centroidPositions = {};

      L.TileLayer.prototype.initialize.call(this, '', options);
    },

    _currentGroupId: null,

    _getGroupIdFromPos: function(pos) {
      var tile = { x: (pos.x/256) | 0, y: (pos.y/256) | 0 };
      var key = this._tileCoordsToKey(tile);
      var tileX = pos.x - 256*tile.x;
      var tileY = pos.y - 256*tile.y;
      if (!this._tileObjects[key]) {
        return null;
      }
      return this._tileObjects[key].featureAt(tileX, tileY);
    },

    _getTileFromPos: function(pos) {
      var tile = { x: (pos.x/256) | 0, y: (pos.y/256) | 0 };
      var key = this._tileCoordsToKey(tile);
      return this._tiles[key];
    },

    onAdd: function(map) {
      map.on('mousedown', function (e) {
        if (!this.options.interaction) {
          return;
        }

        var groupId = this._getGroupIdFromPos(map.project(e.latlng));

        if (groupId === null) {
          return;
        }

// console.log('CLICK', groupId);

        this.fireEvent('featureClick', {
          id: groupId,
          geo: e.latlng,
          x: e.originalEvent.x,
          y: e.originalEvent.y
        });
      }, this);

      map.on('mousemove', function (e) {
        if (!this.options.interaction) {
          return;
        }

        var pos = map.project(e.latlng);
        var tile = this._getTileFromPos(pos);
        if (tile) {
          tile.style.cursor = 'inherit';
        }
        var groupId = this._getGroupIdFromPos(pos);

        var payload = {
          geo: e.latlng,
          x: e.originalEvent.x,
          y: e.originalEvent.y
        };

        if (groupId && groupId === this._currentGroupId) {
          payload.id = groupId;
          this.fireEvent('featureOver', payload);
          if (tile) {
            tile.style.cursor = 'pointer';
          }
          return;
        }

        if (groupId === null) {
          delete payload.id;
          this.fireEvent('featureOut', payload);
        } else {
          if (this._currentGroupId !== null) {
            payload.id = this._currentGroupId;
            this.fireEvent('featureLeave', payload);
          }

          payload.id = groupId;
          this.fireEvent('featureEnter', payload);
        }

        this._currentGroupId = groupId;
      }, this);

      return L.TileLayer.prototype.onAdd.call(this, map);
    },

    _removeTile: function(key) {
      delete this._tileObjects[key];
      L.TileLayer.prototype._removeTile.call(this, key);
    },

    createTile: function(coords) {
      var tile = new Tile({
        coords: coords,
        layer: this,
        provider: this._provider,
        renderer: this._renderer
      });

      var key = this._tileCoordsToKey(coords);
      this._tileObjects[key] = tile;

      return tile.getDomElement();
    },

    redraw: function(forceReload) {
      if (!!forceReload) {
        this._centroidPositions = {};
        L.TileLayer.prototype.redraw.call(this);
        return this;
      }

      var timer = Profiler.metric('tiles.render.time').start();

      // get viewport tile bounds in order to render immediately, when visible
      var bounds = this._map.getPixelBounds(),
        tileSize = this._getTileSize(),
        tileBounds = L.bounds(
          bounds.min.divideBy(tileSize).floor(),
          bounds.max.divideBy(tileSize).floor());

      var renderQueue = [];
      for (var key in this._tileObjects) {
        if (tileBounds.contains(this._keyToTileCoords(key))) {
          this._tileObjects[key].render();
        } else {
          renderQueue.push(this._tileObjects[key]);
        }
      }

      // render invisible tiles afterwards + a bit later in order to stay responsive
      if (renderQueue.length) {
        var interval = setInterval(function() {
          renderQueue[renderQueue.length-1].render();
          renderQueue.pop();
          if (!renderQueue.length) {
            clearInterval(interval);
          }
        }, 250);
      }

      timer.end();

      return this;
    },

    getCentroid: function(feature) {
      var
        scale = Math.pow(2, this._map.getZoom()),
        pos;

      if (pos = this._centroidPositions[feature.groupId]) {
        return { x: pos.x*scale <<0, y: pos.y*scale <<0 };
      }

      var featureParts = this._getFeatureParts(feature.groupId);
      if (pos = Geometry.getCentroid(featureParts)) {
        this._centroidPositions[feature.groupId] = { x: pos.x/scale, y: pos.y/scale };
        return pos;
      }
    },

    _getFeatureParts: function(groupId) {
      var
        tileObject,
        feature, f, fl,
        featureParts = [];

      for (var key in this._tileObjects) {
        tileObject = this._tileObjects[key];
        for (f = 0, fl = tileObject._data.length; f < fl; f++) {
          feature = tileObject._data[f];
          if (feature.groupId === groupId) {
            featureParts.push({ feature:feature, tileCoords:tileObject.getCoords() });
          }
        }
      }
      return featureParts;
    },

    setInteraction: function(flag) {
      this.options.interaction = !!flag;
      return this;
    }
  });
}
