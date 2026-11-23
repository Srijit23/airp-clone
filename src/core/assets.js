import { TextureLoader, RepeatWrapping, SRGBColorSpace } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

// Handles own a reference to shared GPU resources. Rejected loads can be retried.
export class AssetManager {
  constructor(manifest, anisotropy = 4) {
    this.manifest = manifest;
    this.anisotropy = anisotropy;
    this.entries = new Map();
    this.textures = new TextureLoader();
    this.models = new GLTFLoader();
    this.draco = null;
  }
  async load(spec) {
    if (spec.type === 'texture') {
      const tex = await this.textures.loadAsync(spec.url);
      tex.wrapS = tex.wrapT = RepeatWrapping;
      tex.anisotropy = this.anisotropy;
      if (spec.color) tex.colorSpace = SRGBColorSpace;
      return { value: tex, dispose: () => tex.dispose() };
    }
    if (spec.type !== 'gltf')
      throw Error('Unsupported asset type: ' + spec.type);
    if (spec.meshopt) {
      const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
      this.models.setMeshoptDecoder(MeshoptDecoder);
    }
    if (spec.draco) {
      if (!this.draco) {
        this.draco = new DRACOLoader();
        this.draco.setDecoderPath(import.meta.env.BASE_URL + 'assets/draco/');
        this.draco.setDecoderConfig({ type: 'wasm' });
        this.models.setDRACOLoader(this.draco);
      }
    }
    const gltf = await this.models.loadAsync(spec.url),
      resources = new Set();
    const root = gltf.scene;
    // The asset manifest owns all import normalization; placements use metres.
    root.scale.multiplyScalar(spec.metresPerUnit ?? 1);
    root.rotation.y += spec.yawOffset ?? 0;
    for (const scene of gltf.scenes)
      scene.traverse((node) => {
        if (node.geometry) resources.add(node.geometry);
        if (node.skeleton) resources.add(node.skeleton);
        for (const mat of [].concat(node.material || [])) {
          resources.add(mat);
          for (const tex of Object.values(mat))
            if (tex?.isTexture) resources.add(tex);
        }
      });
    return {
      value: { instantiate: () => clone(root), animations: gltf.animations },
      dispose: () => {
        const bitmaps = new Set();
        for (const resource of resources) {
          // These bitmaps come from the tree GLB's private embedded buffer views.
          // Three releases GPU textures on dispose; the bitmap also owns decoded pixels.
          if (spec.category === 'tree' && resource.isTexture && resource.image?.close)
            bitmaps.add(resource.image);
          resource.dispose();
        }
        for (const bitmap of bitmaps) bitmap.close();
      },
    };
  }
  dispose() {
    this.draco?.dispose();
    this.draco = null;
  }
  async acquire(id) {
    const spec = this.manifest[id];
    if (!spec) throw Error('Unknown asset: ' + id);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { refs: 0, promise: this.load(spec) };
      this.entries.set(id, entry);
    }
    entry.refs++;
    let loaded;
    try {
      loaded = await entry.promise;
    } catch (error) {
      if (this.entries.get(id) === entry) this.entries.delete(id);
      throw Error('Could not load ' + id, { cause: error });
    }
    let released = false;
    return {
      value: loaded.value,
      release: () => {
        if (released) return;
        released = true;
        if (--entry.refs === 0) {
          this.entries.delete(id);
          loaded.dispose();
        }
      },
    };
  }
}
