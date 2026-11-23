import { treeSpecies } from '../trees/species.js';
const textures = [
  ['meadow', 'rocky_terrain_02'],
  ['stone', 'aerial_rocks_02'],
  ['silt', 'aerial_ground_rock'],
];
export const manifest = Object.fromEntries(
  textures.flatMap(([name, source]) =>
    ['', '-surface'].map((suffix) => {
      const id = name + suffix;
      return [
        id,
        {
          id,
          type: 'texture',
          category: 'terrain',
          tags: [name],
          url: import.meta.env.BASE_URL + 'assets/terrain/' + id + '.webp',
          source: 'https://polyhaven.com/a/' + source,
          license: 'CC0-1.0',
          color: !suffix,
        },
      ];
    }),
  ),
);

for (const [id, source] of [
  ['asphalt', 'worn_asphalt'],
  ['pavers', 'floor_pavement'],
]) {
  for (const suffix of ['', '-surface']) {
    const name = id + suffix;
    manifest[name] = {
      id: name,
      type: 'texture',
      category: 'roads',
      tags: [id],
      url: import.meta.env.BASE_URL + 'assets/roads/' + name + '.webp',
      source: 'https://polyhaven.com/a/' + source,
      license: 'CC0-1.0',
      color: !suffix,
    };
  }
}

for(const id of ['homes','city','works','garden','canopy'])
  manifest[id]={id,type:'gltf',category:'environment',license:id==='canopy'?'MIT':'CC0-1.0',url:import.meta.env.BASE_URL+'city/models/'+id+'.glb'};
for(const id of ['diff','nor_gl','oak','pine','bark','sand_02','forest_floor'])
  manifest['place-'+id]={id:'place-'+id,type:'texture',category:'environment',color:!['diff','nor_gl'].includes(id),url:import.meta.env.BASE_URL+'assets/places/'+id+'.webp'};

for (const species of treeSpecies) {
  const id = species.assetId;
  manifest[id] = { id, type: 'gltf', category: 'tree', meshopt: true,
    url: import.meta.env.BASE_URL + species.modelPath, source: species.source.url, license: species.source.license };
}

manifest['forest-cover']={id:'forest-cover',type:'texture',category:'forest',color:false,
  url:import.meta.env.BASE_URL+'assets/trees/forest-cover.webp'};

manifest['player-robot'] = {
  id: 'player-robot',
  type: 'gltf',
  category: 'character',
  url: import.meta.env.BASE_URL + 'assets/characters/robot-expressive.glb',
  source: 'https://github.com/mrdoob/three.js/tree/master/examples/models/gltf/RobotExpressive',
  license: 'CC0-1.0',
};

manifest['city-car'] = {
  id: 'city-car',
  type: 'gltf',
  category: 'vehicle',
  url: import.meta.env.BASE_URL + 'assets/vehicles/dragster.glb',
  source: 'https://github.com/nbogie/three-js-cars-2/blob/main/models/car2_dragster.glb',
  license: 'CC-BY-4.0',
};
