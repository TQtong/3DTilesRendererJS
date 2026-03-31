# BugFix: QuantizedMeshPlugin + ImageOverlayPlugin 遍历崩溃

## 错误信息

```
traverseFunctions.js:50 Uncaught TypeError: Cannot read properties of undefined (reading 'lastFrameVisited')
    at resetFrameState (traverseFunctions.js:50)
    at markUsedTiles (traverseFunctions.js:188)
    ...
    at TilesRendererBase.update (TilesRendererBase.js:542)
```

```
TilesRenderer.js:813 Uncaught TypeError: Cannot read properties of null (reading 'length')
    at disposeTile (TilesRenderer.js:813)
```

## 复现条件

使用 `QuantizedMeshPlugin`（地形）+ `ImageOverlayPlugin`（影像叠加）组合时，当 LRU 缓存卸载 tile 后重新加载，触发崩溃。

## 根因分析

### Bug 1: `QuantizedMeshPlugin.disposeTile` 子节点清理不完整

**文件**: `src/three/plugins/QuantizedMeshPlugin.js`

`expandChildren()` 向 `tile.children` 追加子节点时，实际子节点和虚拟子节点是**交替排列**的：

```
expandChildren 后: tile.children = [Real, Virtual, Real, Virtual]
                                     ↑ index 0          ↑ index 3
```

但 `disposeTile()` 只从**末尾**删除 `virtualChildCount` 个子节点，错误地假设虚拟子节点都在末尾：

```js
// 原始代码 - 只删除末尾 N 个
tile.children.length -= virtualChildCount;
```

这导致 dispose 后部分已处理的旧子节点残留在 `tile.children` 中。

### Bug 2: dispose → reload 循环导致 `tile.traversal` 未定义

完整触发流程：

1. **首次加载**: `expandChildren` → `tile.children = [C1, C2, V1, V2]`，全部被 `preprocessNode` 处理（获得 `.traversal`）
2. **LRU 卸载**: `disposeTile` 删除末尾 2 个 → `tile.children = [C1, C2]`（已处理，有 `.traversal`）
3. **重新加载**: `expandChildren` 追加新子节点 → `tile.children = [C1, C2, C5, C6, V3, V4]`
4. **遍历**: `ensureChildrenArePreprocessed` 检查 `children[0]`(C1) 有 `.traversal` → **跳过处理！**
5. **崩溃**: C5, C6, V3, V4 没有 `.traversal` → 遍历到它们时 `tile.traversal.lastFrameVisited` 抛出 TypeError

### Bug 3: `TilesRenderer.disposeTile` 缺少 null 检查

`QuantizedMeshPlugin` 创建的 tile 只设置 `engineData.scene`，不设置 `engineData.geometry`/`materials`/`textures`（为 null）。`TilesRenderer.disposeTile()` 在遍历这些数组时未做 null 检查。

## 修复方案

### 修复 1: `src/three/plugins/QuantizedMeshPlugin.js` - disposeTile

```js
// Before: 只删除末尾 virtualChildCount 个
const start = len - virtualChildCount;
for ( let i = start; i < len; i ++ ) {
    tiles.processNodeQueue.remove( tile.children[ i ] );
}
tile.children.length -= virtualChildCount;

// After: 删除所有子节点（含 LRU 缓存清理）
for ( let i = tile.children.length - 1; i >= 0; i -- ) {
    const child = tile.children[ i ];
    tiles.processNodeQueue.remove( child );
    tiles.lruCache.remove( child );
}
tile.children.length = 0;
```

**原因**: 所有子节点（real + virtual）都由 `expandChildren` 创建，依赖父节点的已加载几何体。父节点卸载后子节点无法独立存在，应全部清理。这样重新加载时 `expandChildren` 从干净状态开始追加。

### 修复 2: `src/core/renderer/tiles/TilesRendererBase.js` - ensureChildrenArePreprocessed

```js
// Before: 只检查第一个子节点
if ( children.length === 0 || children[ 0 ].traversal ) { return; }

// After: 同时检查首尾子节点
if ( children.length === 0 || ( children[ 0 ].traversal && children[ children.length - 1 ].traversal ) ) { return; }
```

**原因**: 新子节点总是追加到数组末尾。仅检查 `children[0]` 无法发现末尾新追加的未处理子节点。

### 修复 3: `areChildrenProcessed` (traverseFunctions.js + optimizedTraverseFunctions.js)

同修复 2 的逻辑，`areChildrenProcessed` 也需要检查首尾两个子节点：

```js
// Before
return tile.children.length === 0 || isProcessed( tile.children[ 0 ] );

// After
const children = tile.children;
return children.length === 0 || ( isProcessed( children[ 0 ] ) && isProcessed( children[ children.length - 1 ] ) );
```

### 修复 4: `src/three/renderer/tiles/TilesRenderer.js` - disposeTile null 检查

```js
// Before: 直接遍历可能为 null 的数组
for ( let i = 0, l = geometry.length; ... )

// After: 添加 null 检查
if ( geometry ) { for ( let i = 0, l = geometry.length; ... ) }
if ( materials ) { ... }
if ( textures ) { ... }
```

## 影响的文件

| 文件 | 修改内容 |
|------|---------|
| `src/three/plugins/QuantizedMeshPlugin.js` | `disposeTile` 清理所有子节点 |
| `src/core/renderer/tiles/TilesRendererBase.js` | `ensureChildrenArePreprocessed` 检查首尾 |
| `src/core/renderer/tiles/traverseFunctions.js` | `areChildrenProcessed` 检查首尾 |
| `src/core/renderer/tiles/optimizedTraverseFunctions.js` | `areChildrenProcessed` 检查首尾 |
| `src/three/renderer/tiles/TilesRenderer.js` | `disposeTile` null 检查 |

## 日期

2026-03-12
