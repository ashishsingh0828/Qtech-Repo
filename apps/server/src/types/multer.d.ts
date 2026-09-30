declare module "multer" {
  import type { RequestHandler } from "express";

  interface StorageEngine {
    _brand?: "multer-storage";
  }

  interface Options {
    storage?: StorageEngine;
    limits?: { fileSize?: number };
  }

  interface Multer {
    single(fieldName: string): RequestHandler;
  }

  function multer(options?: Options): Multer;

  namespace multer {
    function memoryStorage(): StorageEngine;
  }

  export default multer;
}
