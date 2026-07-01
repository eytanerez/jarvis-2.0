// Procedural icosahedron mesh: base 12-vertex solid, subdivided so the
// wireframe reads as a faceted-but-smooth sphere, plus a deduplicated edge
// list for gl.LINES rendering.

export interface IcoMesh {
  /** Flat [x,y,z, x,y,z, ...] unit-sphere positions (also the surface normal direction). */
  positions: Float32Array
  /** Pairs of vertex indices, one pair per unique edge. */
  edgeIndices: Uint16Array
  vertexCount: number
}

function baseIcosahedron(): { positions: number[][]; faces: [number, number, number][] } {
  const t = (1 + Math.sqrt(5)) / 2

  const raw: [number, number, number][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
  ]

  const positions = raw.map(([x, y, z]) => {
    const len = Math.sqrt(x * x + y * y + z * z)

    return [x / len, y / len, z / len]
  })

  const faces: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
  ]

  return { positions, faces }
}

/** Subdivide each triangle into 4, projecting new vertices back onto the unit sphere. */
function subdivide(
  positions: number[][],
  faces: [number, number, number][]
): { positions: number[][]; faces: [number, number, number][] } {
  const nextPositions = positions.slice()
  const nextFaces: [number, number, number][] = []
  const midpointCache = new Map<string, number>()

  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    const cached = midpointCache.get(key)

    if (cached !== undefined) {
      return cached
    }

    const pa = nextPositions[a]!
    const pb = nextPositions[b]!
    const mx = (pa[0]! + pb[0]!) / 2
    const my = (pa[1]! + pb[1]!) / 2
    const mz = (pa[2]! + pb[2]!) / 2
    const len = Math.sqrt(mx * mx + my * my + mz * mz) || 1
    const index = nextPositions.length
    nextPositions.push([mx / len, my / len, mz / len])
    midpointCache.set(key, index)

    return index
  }

  for (const [a, b, c] of faces) {
    const ab = midpoint(a, b)
    const bc = midpoint(b, c)
    const ca = midpoint(c, a)
    nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
  }

  return { positions: nextPositions, faces: nextFaces }
}

export function buildIcoMesh(subdivisions = 3): IcoMesh {
  let { positions, faces } = baseIcosahedron()

  for (let i = 0; i < subdivisions; i++) {
    ;({ positions, faces } = subdivide(positions, faces))
  }

  const edgeSet = new Set<string>()
  const edges: [number, number][] = []

  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`

    if (!edgeSet.has(key)) {
      edgeSet.add(key)
      edges.push(a < b ? [a, b] : [b, a])
    }
  }

  for (const [a, b, c] of faces) {
    addEdge(a, b)
    addEdge(b, c)
    addEdge(c, a)
  }

  const flatPositions = new Float32Array(positions.length * 3)
  positions.forEach(([x, y, z], i) => {
    flatPositions[i * 3] = x!
    flatPositions[i * 3 + 1] = y!
    flatPositions[i * 3 + 2] = z!
  })

  const edgeIndices = new Uint16Array(edges.length * 2)
  edges.forEach(([a, b], i) => {
    edgeIndices[i * 2] = a
    edgeIndices[i * 2 + 1] = b
  })

  return { edgeIndices, positions: flatPositions, vertexCount: positions.length }
}
