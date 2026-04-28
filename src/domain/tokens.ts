export const estimateTokenCount = (content: string): number =>
  Math.ceil(content.trim().split(/\s+/).filter(Boolean).join(' ').length / 4)
