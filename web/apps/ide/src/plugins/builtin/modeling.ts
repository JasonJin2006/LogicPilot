// Neutral composition seam for the builtin graph/modeling implementation.
// Consumers outside plugins use this surface instead of importing the
// paradigm's block catalogue directly.
export {
  BLOCK_DEFS,
  CANVAS_CONTAINER_KINDS,
  blockPorts,
  isExecutableProcessKind,
  portGlyphPoint,
} from '../../model/blockDefs';
