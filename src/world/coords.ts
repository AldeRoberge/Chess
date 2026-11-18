/** World = metres, y up. Board centre is the origin on the table top; white sits at +z. */
export const SQUARE = 0.0575; // 46 cm board
export const TABLE_Y = 0.75;
/** Board coords (u right, v down from rank 8; 0..8) <-> world x/z. */
export const boardToWorld = (u: number, v: number): [number, number, number] => [(u - 4) * SQUARE, TABLE_Y, (v - 4) * SQUARE];
export const worldToBoard = (x: number, z: number) => ({ x: x / SQUARE + 4, y: z / SQUARE + 4 });
