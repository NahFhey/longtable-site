# three.js r186

Copied from `proto/raid-3d:site/proto-raid-3d/vendor/`. Upstream MIT license is in `LICENSE`.
`LICENSE-three` was renamed to `LICENSE`. The core and module files are unchanged.
GLTFLoader imports both BufferGeometryUtils and SkeletonUtils, so both are included.
No import map, CDN, build step or npm package is needed.

Only source changes (line numbers are identical in source and destination):

- `addons/loaders/GLTFLoader.js:67`: `} from 'three';` → `} from '../../three.module.js';`
- `addons/utils/BufferGeometryUtils.js:12`: `} from 'three';` → `} from '../../three.module.js';`
- `addons/utils/SkeletonUtils.js:10`: `} from 'three';` → `} from '../../three.module.js';`
