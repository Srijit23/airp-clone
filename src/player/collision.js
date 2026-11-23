// Collision queries share the existing game world's terrain, parcel and tree records.
import { buildingAt } from '../places/records.js';
import { shoreline } from '../world/regions.js';
import { TILE, tileAt } from '../data/world.js';
import { treeSpecies } from '../trees/species.js';
import { promenadeHeight } from '../places/promenade.js';
import { BODY_HEIGHT, BODY_RADIUS } from './physics.js';

const cellKey = (x, z) => Math.floor(x / 128) + ',' + Math.floor(z / 128);

export class CharacterWorld {
  constructor(controls, forest, places, streamer) {
    this.controls = controls;
    this.forest = forest;
    this.places = places;
    this.streamer = streamer;
    this.planted = new Map();
    // The authored ornamental trees are static, unlike the recycled render batches.
    for (const lot of places.lots) {
      if (!lot.tree) continue;
      const tree = lot.tree;
      const key = cellKey(tree.x, tree.z);
      if (!this.planted.has(key)) this.planted.set(key, []);
      this.planted.get(key).push(tree);
    }
  }

  height(x, z) {
    return this.controls.height(x, z);
  }

  blocked(x, z, footY) {
    const building = buildingAt(x, z, BODY_RADIUS);
    if (building && footY < building.position.y + building.height &&
        footY + BODY_HEIGHT > building.position.y) return true;

    // Swimming is not implemented. The boardwalk remains traversable offshore.
    if (z > shoreline(x) && promenadeHeight(x, z) === null) return true;

    if (this.forestTrunk(x, z, footY)) return true;
    if (this.plantedTree(x, z, footY)) return true;
    return false;
  }

  forestTrunk(x, z, footY) {
    const pad = BODY_RADIUS + 0.65;
    for (let tz = tileAt(z - pad); tz <= tileAt(z + pad); tz++)
      for (let tx = tileAt(x - pad); tx <= tileAt(x + pad); tx++) {
        const tile = this.forest.tiles.get(tx + ',' + tz);
        if (!tile) continue;
        const records = tile.records;
        const resolution = this.streamer.resolutionAt(tx * TILE + 1, tz * TILE + 1);
        const h = resolution === 32 ? 4 : resolution === 16 ? 3 : 2;
        for (let k = 0; k < records.length; k += 8) {
          const species = treeSpecies[records[k + 5]];
          if (!species) continue;
          const scale = records[k + 6];
          const radius = species.collision.radius * scale + BODY_RADIUS;
          const dx = x - tx * TILE - records[k];
          if (Math.abs(dx) >= radius) continue;
          const dz = z - tz * TILE - records[k + 1];
          if (dx * dx + dz * dz >= radius * radius) continue;
          const bottom = records[k + h];
          if (footY < bottom + species.dimensions.height * scale &&
              footY + BODY_HEIGHT > bottom) return true;
        }
      }
    return false;
  }

  plantedTree(x, z, footY) {
    // Only collide with solid trunks/rocks, not soft grass, shrubs and flowers.
    const hits = (tree, size) => {
      const radius = size + BODY_RADIUS;
      return (tree.x - x) ** 2 + (tree.z - z) ** 2 < radius * radius &&
        footY < tree.y + tree.height && footY + BODY_HEIGHT > tree.y;
    };
    const cx = Math.floor(x / 128), cz = Math.floor(z / 128);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const id = cx + dx + ',' + (cz + dz);
        for (const tree of this.planted.get(id) || [])
          if (hits(tree, tree.asset.includes('palm') ? 0.34 : 0.4)) return true;
        for (const tree of this.places.cells.get(id) || []) {
          const radius = tree.asset === 'pine' ? 0.42 :
            tree.asset === 'broadleaf' ? 0.38 :
            tree.asset.includes('palm') ? 0.33 :
            tree.asset.includes('rock') ? Math.min(0.62, tree.height * 0.32) : 0;
          if (radius && hits(tree, radius)) return true;
        }
      }
    return false;
  }
}
