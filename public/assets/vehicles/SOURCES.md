# AIRP vehicle asset credits

## Driveable 80s Wedge Sports Car (current vehicle)

- **Model**: Wedge, sourced unchanged as `models/wedge.glb`
- **Project and author**: Collect Cars by drcollect; concept and Blender model authored for that project
- **License**: Creative Commons Attribution 4.0 International (CC BY 4.0)
- **Source**: https://github.com/drcollect/collect-cars/blob/main/models/wedge.glb
- **Model license and usage**: https://github.com/drcollect/collect-cars#license
- **License text**: https://creativecommons.org/licenses/by/4.0/
- **Source Git blob**: `345f673154f9a9cc6a7223b483cbe4b1a595c83d`
- **Geometry**: original Draco-compressed glTF 2.0 asset, 71,240 triangles, authored in metres, nose +Z
- **Wheel geometry**: separate source Cover, Lip, Tyre meshes for front-left, front-right, rear-left and rear-right; runtime groups only, no replacement wheel geometry

The source asset is distributed unchanged at `public/assets/vehicles/wedge.glb`.
AIRP dynamically groups the imported original wheel parts and moves the model
in its metre-based world. The source's materials and geometry are retained.
Attribution is supplied under CC BY 4.0. This does not imply the artists
endorse or sponsor AIRP.

## Draco runtime decoder

- **Project**: Google Draco geometric mesh decoder, Apache-2.0
- **Official source**: https://github.com/google/draco
- **Builds packaged from**: https://github.com/mrdoob/three.js/tree/master/examples/jsm/libs/draco/gltf
- **Files bundled locally**: `draco_decoder.wasm`, `draco_wasm_wrapper.js` under `public/assets/draco/`
- **License**: Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0

The browser loads the Draco decoder from AIRP itself, with no third-party
asset request or external CDN dependency during gameplay.

## Controls

Approach the car and press E to enter or exit. W accelerates, S brakes and
reverses once stopped, A/D steer, Space uses the handbrake and the mouse
wheel adjusts chase-camera distance. Driving and static collisions are
implemented separately under `src/vehicles/`.
