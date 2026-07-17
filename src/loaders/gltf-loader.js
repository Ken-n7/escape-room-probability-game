import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Single factory so every loader in the project has MeshoptDecoder set.
// Required after compressing GLBs with gltf-transform (EXT_meshopt_compression).
export function makeGLTFLoader() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

export function loadGLTF(path) {
  return new Promise((resolve, reject) => makeGLTFLoader().load(path, resolve, undefined, reject));
}
