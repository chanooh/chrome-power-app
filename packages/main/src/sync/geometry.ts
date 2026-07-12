export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const containsPoint = (rectangle: Rectangle, x: number, y: number) =>
  x >= rectangle.x &&
  y >= rectangle.y &&
  x <= rectangle.x + rectangle.width &&
  y <= rectangle.y + rectangle.height;

export const mapRelativePoint = (
  source: Rectangle,
  destination: Rectangle,
  x: number,
  y: number,
) => {
  if (source.width <= 0 || source.height <= 0) {
    throw new Error('Source window bounds are invalid');
  }
  const relativeX = Math.max(0, Math.min(1, (x - source.x) / source.width));
  const relativeY = Math.max(0, Math.min(1, (y - source.y) / source.height));
  return {
    x: destination.x + relativeX * destination.width,
    y: destination.y + relativeY * destination.height,
  };
};
