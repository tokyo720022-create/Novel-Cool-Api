import { Router } from "express";
import { MangaController } from "../controller/mangas.js";
import { asyncHandler } from "../middleware/errorHandler.js";

export const mangasRouter = Router()


mangasRouter.get('/index', asyncHandler(MangaController.Index))
mangasRouter.get('/lasted', asyncHandler(MangaController.Lasted))
mangasRouter.get('/complete', asyncHandler(MangaController.Complete))
mangasRouter.get('/romance', asyncHandler(MangaController.Romance))
mangasRouter.get('/comedy', asyncHandler(MangaController.Comedy))
mangasRouter.get('/drama', asyncHandler(MangaController.Drama))
mangasRouter.get('/action', asyncHandler(MangaController.Action))
mangasRouter.get('/webcomic', asyncHandler(MangaController.Webcomic))
mangasRouter.get('/category/:category', asyncHandler(MangaController.Category))
mangasRouter.get('/search', asyncHandler(MangaController.search))
mangasRouter.get('/view/:id', asyncHandler(MangaController.info))
mangasRouter.get('/info/genres', asyncHandler(MangaController.genres))
mangasRouter.get('/reader/:ch/:id', asyncHandler(MangaController.reader))




