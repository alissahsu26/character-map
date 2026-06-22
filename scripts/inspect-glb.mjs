import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { inspectGlbHierarchy } from '../src/utils/inspectGlbHierarchy.js';

globalThis.self = globalThis;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(__dirname, '../src/assets/charlie_the_fox_vrc.glb');

const buffer = fs.readFileSync(modelPath);
const loader = new GLTFLoader();

loader.parse(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  pathToDir(modelPath),
  (gltf) => {
    inspectGlbHierarchy(gltf.scene, 'charlie_the_fox_vrc.glb');
  },
  (err) => {
    console.error('Failed to parse GLB:', err);
    process.exit(1);
  }
);

function pathToDir(filePath) {
  return path.dirname(filePath) + path.sep;
}
