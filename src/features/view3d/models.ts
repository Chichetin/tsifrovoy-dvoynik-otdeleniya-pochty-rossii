/**
 * #59: catalog 3D models on the Three.js side. A model file is fetched once
 * per name; a fitted copy is made once per name and size and shared by every
 * object of that size, so a room of identical desks is one draw call per part.
 *
 * A missing or broken file is not an error for the user: the object keeps the
 * box it had before models existed.
 */

import { BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fitPositions, type Fit, type Repeat, type Vec3 } from './model-fit';

type Part = { geometry: BufferGeometry; material: Material; repeat?: Repeat };
export type ModelSource = { parts: Part[]; fit: Fit };
export type FittedPart = { geometry: BufferGeometry; material: Material };

/** glTF is Y-up; the plan is Z-up (D-010): (x, y, z) → (x, -z, y). */
const Z_UP = new Matrix4().makeRotationX(Math.PI / 2);

const loader = new GLTFLoader();
const loading = new Map<string, Promise<void>>();
/** Settled loads: the source, or null when the file is missing or unreadable. */
const loaded = new Map<string, ModelSource | null>();

export function modelSource(name: string): ModelSource | null | undefined {
  return loaded.get(name);
}

/** Starts loading the models not asked for yet; resolves when they settle. */
export function loadModels(names: Iterable<string>): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const name of names) {
    let load = loading.get(name);
    if (load === undefined) {
      load = loader
        .loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`)
        .then((gltf) => {
          loaded.set(name, readSource(gltf.scene));
        })
        .catch(() => {
          loaded.set(name, null);
        });
      loading.set(name, load);
      pending.push(load);
    }
  }
  return Promise.all(pending).then(() => undefined);
}

function readSource(root: Object3D): ModelSource | null {
  const node = root.getObjectByName('model');
  const fit = node?.userData as Partial<Fit> | undefined;
  if (fit?.fit === undefined || fit.size === undefined) return null;
  root.updateWorldMatrix(true, true);
  const parts: Part[] = [];
  root.traverse((child) => {
    if (!(child instanceof Mesh) || Array.isArray(child.material)) return;
    // A part with several materials is a group of meshes; extras sit on the group.
    const repeat = (child.userData['repeat'] ?? child.parent?.userData['repeat']) as Repeat | undefined;
    const geometry = (child.geometry as BufferGeometry).clone().applyMatrix4(child.matrixWorld).applyMatrix4(Z_UP);
    parts.push({ geometry, material: child.material as Material, ...(repeat === undefined ? {} : { repeat }) });
  });
  return { parts, fit: fit as Fit };
}

/** Geometry of every part fitted to `size`; repeated parts are merged into one. */
export function fitModel(source: ModelSource, size: Vec3): FittedPart[] {
  return source.parts.map((part) => {
    const position = part.geometry.getAttribute('position');
    const copies = fitPositions(position.array, source.fit, size, part.repeat).map((positions) => {
      const copy = part.geometry.clone();
      copy.setAttribute('position', new Float32BufferAttribute(positions, 3));
      return copy;
    });
    const geometry = copies.length === 1 ? copies[0]! : mergeGeometries(copies);
    if (copies.length > 1) copies.forEach((copy) => copy.dispose());
    geometry.computeBoundingSphere();
    return { geometry, material: part.material };
  });
}
