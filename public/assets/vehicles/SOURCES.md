# AIRP Vehicle Asset Credit

- **Model**: `car2_dragster.glb` (original independently-modelled car with four wheel meshes)
- **Author**: Neill Bogie (© 2020)
- **License**: Creative Commons Attribution 4.0 International (CC BY 4.0)
- **Original file**: https://github.com/nbogie/three-js-cars-2/blob/main/models/car2_dragster.glb
- **Model license and author details**: https://github.com/nbogie/three-js-cars-2/blob/main/models/README.md
- **License text**: https://creativecommons.org/licenses/by/4.0/
- **Git source blob SHA**: `4cb80b03de57f5d828d0af889c18bbe7fca190e7`

The complete unmodified source GLB is retained at
`public/assets/vehicles/dragster.glb`; AIRP uniformly scales and turns the
model at runtime to align it with the existing metre-based world. All four
original wheel objects (`wheel_fl`, `wheel_fr`, `wheel_bl`, `wheel_br`)
remain separate and are animated using steering angle and travelled distance.

The driving, collision and camera code in `src/vehicles/` was separately
implemented for AIRP. This attribution is provided to comply with the model's
CC BY 4.0 license and does not imply the original artist endorses AIRP.

**Controls**: approach car, E enter/exit; W accelerate, S brake/reverse,
A/D steer, Space handbrake, mouse to glance around, wheel scroll to zoom.
