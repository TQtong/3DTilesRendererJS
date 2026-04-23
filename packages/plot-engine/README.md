# um-plot-engine

Standalone GIS plotting engine that can attach to one or more `3d-tiles-renderer`
`TilesRenderer` instances without exposing itself as a `TilesRenderer` plugin.

```js
import { PlotEngine } from 'um-plot-engine';

const engine = new PlotEngine();
scene.add( engine.group );
engine.attachTilesRenderer( 'terrain', tilesRenderer, {
  geoReference: { kind: 'cartographic' },
} );
engine.attachTilesRenderer( 'bim', bimTilesRenderer, {
  geoReference: { kind: 'placed-cartographic' },
} );
engine.addShape( {
  id: 'aoi',
  kind: 'polygon',
  coordinates: [
    [ 121.1, 31.1 ],
    [ 121.2, 31.1 ],
    [ 121.2, 31.2 ],
  ],
  attachment: { mode: 'tiles', targetId: 'terrain' },
} );
engine.addShape( {
  id: 'bim-outline',
  kind: 'polygon',
  coordinates: [
    [ 121.101, 31.101 ],
    [ 121.102, 31.101 ],
    [ 121.102, 31.102 ],
  ],
  attachment: { mode: 'tiles', targetId: 'bim' },
} );
engine.start();
```
