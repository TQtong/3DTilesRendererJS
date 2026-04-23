# `PLOT_ENGINE_PLAN.md` 修订版：`PlotEngine` 独立子包方案

## Summary
- `PlotEngine` 是独立 GIS 标绘引擎，`3DTilesRendererJS` 是独立 3D Tiles 渲染库，两者同级协作。
- `PlotEngine` 以独立 workspace 子包 `packages/plot-engine` 落地，发布名为 `um-plot-engine`。
- `3DTilesRendererJS` 的 tile 生命周期仅作为 `PlotEngine` 内部 `TilesRendererIntegration` 的接入机制，不作为公开 API。
- 旧标绘链路已从 `src/three/plugins` 和 `example/three/plot` 中移除，不保留兼容层。

## Implemented Scope
- 已落地独立子包结构：
  - `PlotEngine`
  - `ShapeStore`
  - `CompilerRegistry`
  - `SpatialIndex`
  - `TargetRegistry`
  - `WorldPipe`
  - `SurfacePipe`
  - `TiledPipe`
  - `TilesRendererIntegration`
- 已实现命令式 API：
  - `new PlotEngine(options)`
  - `engine.start()` / `engine.stop()`
  - `engine.attachTilesRenderer(id, tilesRenderer, options)`
  - `engine.attachObjectTarget(id, object3D, options)`
  - `engine.detachTarget(id)`
  - `engine.addShape(shape)` / `engine.updateShape(id, patch)` / `engine.removeShape(id)`
  - `engine.select(ids)` / `engine.setMode(mode)` / `engine.invalidate()`
- 已实现基础 shape 编译器：
  - `point`
  - `line`
  - `polygon`
  - `rectangle`
  - `circle`
  - `sector`
  - `arrow`（编译为 polygon）
- 已实现基础 SDF 打包与 `DataTexture` 生成。
- 已实现多 `TilesRenderer` 接入、已加载 tile 扫描、`load-model` / `dispose-model` / `tile-visibility-change` 事件桥接。

## Architecture
```text
PlotEngine
├─ ShapeStore
├─ CompilerRegistry
├─ SpatialIndex (rbush)
├─ TargetRegistry
├─ WorldPipe
├─ SurfacePipe
├─ TiledPipe
└─ TilesRendererIntegration
```

- `PlotEngine` 暴露独立引擎 API，并自带 RAF 更新循环。
- `TargetRegistry` 统一管理 `object` 与 `tiles-renderer` 两类目标。
- `TilesRendererIntegration` 只负责把 `TilesRenderer` 生命周期转发给引擎。
- `WorldPipe` 把 `world` attachment 渲染到 `engine.group`。
- `SurfacePipe` 把 `surface` attachment 渲染到目标 `Object3D` 下。
- `TiledPipe` 为 tile mesh 创建共享 geometry 的独立 decal mesh，并以 per-tile SDF 纹理驱动材质。

## Contracts
```ts
type GeoReference = { kind: 'cartographic' | 'placed-cartographic' | 'local' };

type Attachment = {
  mode: 'world' | 'surface' | 'tiles';
  targetId?: string | number;
};

type PlotTarget =
  | { id: string | number; type: 'object'; object3D: Object3D; options: PlotTargetOptions }
  | { id: string | number; type: 'tiles-renderer'; tilesRenderer: any; options: PlotTargetOptions };

type PlotShape = {
  id?: string | number;
  kind: string;
  coordinates: Array<[number, number] | [number, number, number]>;
  style?: Record<string, any>;
  attachment?: Attachment;
  userData?: Record<string, any>;
  revision?: number;
};
```

## Validation
- 已新增单测覆盖：
  - `ShapeStore`
  - `CompilerRegistry`
  - `SdfDataBuilder`
  - `SpatialIndex`
  - `PlotEngine` 基础集成
- 已将 `um-plot-engine` 加入 workspace，并为本地示例/开发增加 `vite` alias。

## Next Steps
- 将 `TiledPipe` 的占位着色器升级为完整 SDF 求值管线。
- 为 `placed-cartographic` 与 `local` 目标补齐更严格的 tile bounds / 坐标转换。
- 增加文本 atlas、交互编辑层、undo/redo 和更完整的性能压测。
