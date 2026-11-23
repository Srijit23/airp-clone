# Character source and license

**Model:** RobotExpressive.glb (the actual rigged source asset, not procedural replacement geometry)

- Original artist: Tomás Laulhé (Quaternius)
- glTF modifications: Don McCurdy
- Repository: https://github.com/mrdoob/three.js/tree/master/examples/models/gltf/RobotExpressive
- Download: https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/gltf/RobotExpressive/RobotExpressive.glb
- License: Creative Commons Zero 1.0 Universal (CC0-1.0)
- License description: https://github.com/mrdoob/three.js/blob/master/examples/models/gltf/RobotExpressive/README.md
- Source Git blob SHA: `6fec9cfb4b41cb319c70d38cf86965aba5630964`
- File size: 463,988 bytes

The original GLB includes skeletal animation clips: Idle, Walking, Running, Jump,
WalkJump and other motions. AIRP uses the source rig, materials, skeleton,
and animations, with a runtime uniform size adjustment for the world's metre scale.

The game's player movement, physics, terrain-grounding, sliding collision response,
and third-person camera live in `src/player/`. The character itself remains the
unchanged public-domain third-party model.

Controls: WASD move, Shift run, Space jump, mouse/arrow keys look around,
mouse wheel chase-camera zoom, V switch character/spectator, G switch the
spectator flight/ground view. Other world inputs remain available.
