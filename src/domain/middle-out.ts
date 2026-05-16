export const middleOutIndices = (size: number, pivotIndex: number): readonly number[] => {
  if (!Number.isFinite(size) || size <= 0) {
    return []
  }

  const clampedPivot = Math.max(0, Math.min(Math.floor(pivotIndex), size - 1))
  const indices = [clampedPivot]

  for (let offset = 1; indices.length < size; offset += 1) {
    const left = clampedPivot - offset
    const right = clampedPivot + offset

    if (left >= 0) {
      indices.push(left)
    }
    if (right < size) {
      indices.push(right)
    }
  }

  return indices
}
