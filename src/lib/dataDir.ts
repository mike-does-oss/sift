import path from "path";

export const DATA_DIR = process.env.SIFT_DATA_DIR
  ? path.resolve(process.env.SIFT_DATA_DIR)
  : path.join(process.cwd(), "data");
